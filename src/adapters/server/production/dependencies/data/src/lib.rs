use std::{
    collections::{HashMap, HashSet},
    fs,
    path::Path,
    sync::Arc,
};

use kit_server_runtime::{
    Dependency, DependencyContext, Engine, NativeError, NativeFuture, NativeResult, Value,
};
use serde_json::{Map, Value as JsonValue, json};
use tokio::sync::Mutex;
use turso::{Connection, params_from_iter};

pub struct Data {
    state: Arc<Mutex<State>>,
}

struct State {
    connection: Connection,
    collections: HashMap<String, Collection>,
}

#[derive(Default)]
struct Collection {
    indexes: HashSet<String>,
    searchable: bool,
    revision: Option<i64>,
    search: Vec<String>,
}

pub async fn create(context: DependencyContext) -> NativeResult<Data> {
    let path = context.configuration("database")?;
    if path != ":memory:"
        && let Some(parent) = Path::new(path).parent()
    {
        fs::create_dir_all(parent)
            .map_err(|error| NativeError::new("DataStoreFailure", error.to_string()))?;
    }
    let database = turso::Builder::new_local(path)
        .experimental_index_method(true)
        .build()
        .await
        .map_err(database_error)?;
    let connection = database.connect().map_err(database_error)?;
    Ok(Data {
        state: Arc::new(Mutex::new(State {
            connection,
            collections: HashMap::new(),
        })),
    })
}

impl Dependency for Data {
    fn call(&self, _engine: Engine, operation: &str, input: Value) -> NativeFuture<Value> {
        let state = self.state.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            let input = input.to_json()?;
            match operation.as_str() {
                "replace" => {
                    replace(&state, &input).await?;
                    Ok(Value::Undefined)
                }
                "query" => query(&state, &input).await,
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Data has no operation {operation:?}."),
                )),
            }
        })
    }
}

async fn replace(state: &Mutex<State>, input: &JsonValue) -> NativeResult<()> {
    let collection = string(input, "collection")?;
    let revision = integer(input, "revision")?;
    if revision < 0 {
        return Err(invalid("revision must be non-negative."));
    }
    let records = array(input, "records")?;
    let indexes = string_array(input, "indexes")?;
    let search = string_array(input, "search")?;
    let table = table(collection);
    let mut state = state.lock().await;
    state
        .connection
        .execute(
            format!(
                "CREATE TABLE IF NOT EXISTS {table} (
                   id TEXT PRIMARY KEY,
                   revision INTEGER NOT NULL,
                   record TEXT NOT NULL,
                   search_text TEXT NOT NULL
                 )"
            ),
            (),
        )
        .await
        .map_err(database_error)?;
    for field in &indexes {
        identifier(field)?;
    }
    for field in &search {
        identifier(field)?;
    }
    let (missing_indexes, create_search) = {
        let configured = state.collections.entry(collection.to_owned()).or_default();
        let missing = indexes
            .iter()
            .filter(|field| configured.indexes.insert((*field).clone()))
            .cloned()
            .collect::<Vec<_>>();
        (missing, !search.is_empty() && !configured.searchable)
    };
    for field in missing_indexes {
        state
            .connection
            .execute(
                format!(
                    "CREATE INDEX IF NOT EXISTS {table}_{} ON {table}(json_extract(record, '$.{field}'))",
                    hash(&field)
                ),
                (),
            )
            .await
            .map_err(database_error)?;
    }
    if create_search {
        state
            .connection
            .execute(
                format!(
                    "CREATE INDEX IF NOT EXISTS {table}_search ON {table} USING fts (search_text)"
                ),
                (),
            )
            .await
            .map_err(database_error)?;
        state
            .collections
            .get_mut(collection)
            .expect("configured collection")
            .searchable = true;
    }
    let configured = state
        .collections
        .get_mut(collection)
        .expect("configured collection");
    if configured
        .revision
        .is_some_and(|current| revision < current)
    {
        return Err(invalid(
            "a data projection cannot move to an earlier revision.",
        ));
    }
    if configured.revision == Some(revision) && configured.search == search {
        return Ok(());
    }

    let transaction = state
        .connection
        .unchecked_transaction()
        .await
        .map_err(database_error)?;
    transaction
        .execute(format!("DELETE FROM {table}"), ())
        .await
        .map_err(database_error)?;
    for record in records {
        let object = record
            .as_object()
            .ok_or_else(|| invalid("projected records must be objects."))?;
        let id = object
            .get("id")
            .and_then(JsonValue::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| invalid("projected records must have a non-empty string id."))?;
        let search_text = search
            .iter()
            .filter_map(|field| object.get(field).and_then(JsonValue::as_str))
            .collect::<Vec<_>>()
            .join("\n");
        transaction
            .execute(
                format!(
                    "INSERT INTO {table} (id, revision, record, search_text) VALUES (?1, ?2, ?3, ?4)"
                ),
                (
                    id.to_owned(),
                    revision,
                    record.to_string(),
                    search_text,
                ),
            )
            .await
            .map_err(database_error)?;
    }
    transaction.commit().await.map_err(database_error)?;
    state
        .collections
        .get_mut(collection)
        .expect("configured collection")
        .revision = Some(revision);
    state
        .collections
        .get_mut(collection)
        .expect("configured collection")
        .search = search;
    Ok(())
}

async fn query(state: &Mutex<State>, input: &JsonValue) -> NativeResult<Value> {
    let collection = string(input, "collection")?;
    let specification = object(input, "query")?;
    let table = table(collection);
    let state = state.lock().await;
    let searchable = state
        .collections
        .get(collection)
        .is_some_and(|collection| collection.searchable);
    let query = compile_query(&table, specification, searchable)?;
    let mut rows = state
        .connection
        .query(&query.sql, params_from_iter(query.parameters))
        .await
        .map_err(database_error)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().await.map_err(database_error)? {
        let record: String = row.get(0).map_err(database_error)?;
        let record: JsonValue = serde_json::from_str(&record)
            .map_err(|error| NativeError::new("DataStoreFailure", error.to_string()))?;
        let score = match row.get_value(1).map_err(database_error)? {
            turso::Value::Integer(value) => Some(value as f64),
            turso::Value::Real(value) => Some(value),
            _ => None,
        };
        result.push(match score {
            Some(score) => json!({ "record": record, "score": score }),
            None => json!({ "record": record }),
        });
    }
    Ok(Value::from_json(&JsonValue::Array(result)))
}

struct Query {
    sql: String,
    parameters: Vec<turso::Value>,
}

fn compile_query(
    table: &str,
    query: &Map<String, JsonValue>,
    searchable: bool,
) -> NativeResult<Query> {
    let mut clauses = Vec::new();
    let mut parameters = Vec::new();
    let text = query
        .get("text")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| invalid("search text must be a string."))
                .map(search_text)
        })
        .transpose()?;
    if let Some(text) = &text {
        if !searchable || text.is_empty() {
            return Ok(Query {
                sql: format!("SELECT record, NULL AS score FROM {table} WHERE 0"),
                parameters,
            });
        }
        clauses.push("fts_match(search_text, ?)".to_owned());
        parameters.push(turso::Value::Text(text.clone()));
    }
    if let Some(where_) = query.get("where") {
        let where_ = where_
            .as_object()
            .ok_or_else(|| invalid("where must be an object."))?;
        for (field, condition) in where_ {
            identifier(field)?;
            compile_condition(
                &format!("json_extract(record, '$.{field}')"),
                condition,
                &mut clauses,
                &mut parameters,
            )?;
        }
    }
    let score = if let Some(text) = &text {
        parameters.insert(0, turso::Value::Text(text.clone()));
        "fts_score(search_text, ?) AS score"
    } else {
        "NULL AS score"
    };
    let order = compile_order(query.get("order"), text.is_some())?;
    let pagination = compile_pagination(query, &mut parameters)?;
    let predicates = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    Ok(Query {
        sql: format!(
            "SELECT record, score FROM (
               SELECT id, record, {score} FROM {table}{predicates}
             ) AS matches ORDER BY {order}{pagination}"
        ),
        parameters,
    })
}

fn compile_condition(
    expression: &str,
    condition: &JsonValue,
    clauses: &mut Vec<String>,
    parameters: &mut Vec<turso::Value>,
) -> NativeResult<()> {
    let Some(operations) = condition.as_object() else {
        return equality(expression, condition, false, clauses, parameters);
    };
    let supported = [
        "equals",
        "not",
        "oneOf",
        "greaterThan",
        "atLeast",
        "lessThan",
        "atMost",
    ];
    if let Some(operation) = operations
        .keys()
        .find(|name| !supported.contains(&name.as_str()))
    {
        return Err(invalid(&format!(
            "unsupported query operation {operation:?}."
        )));
    }
    if let Some(value) = operations.get("equals") {
        equality(expression, value, false, clauses, parameters)?;
    }
    if let Some(value) = operations.get("not") {
        equality(expression, value, true, clauses, parameters)?;
    }
    if let Some(values) = operations.get("oneOf") {
        let values = values
            .as_array()
            .ok_or_else(|| invalid("oneOf must be an array."))?;
        if values.is_empty() {
            clauses.push("0".to_owned());
        } else {
            clauses.push(format!(
                "{expression} IN ({})",
                vec!["?"; values.len()].join(", ")
            ));
            for value in values {
                parameters.push(parameter(value)?);
            }
        }
    }
    comparison(
        expression,
        "greaterThan",
        ">",
        operations,
        clauses,
        parameters,
    )?;
    comparison(expression, "atLeast", ">=", operations, clauses, parameters)?;
    comparison(expression, "lessThan", "<", operations, clauses, parameters)?;
    comparison(expression, "atMost", "<=", operations, clauses, parameters)
}

fn equality(
    expression: &str,
    value: &JsonValue,
    negated: bool,
    clauses: &mut Vec<String>,
    parameters: &mut Vec<turso::Value>,
) -> NativeResult<()> {
    if value.is_null() {
        clauses.push(format!(
            "{expression} IS {}NULL",
            if negated { "NOT " } else { "" }
        ));
    } else {
        clauses.push(format!(
            "{expression} {} ?",
            if negated { "!=" } else { "=" }
        ));
        parameters.push(parameter(value)?);
    }
    Ok(())
}

fn comparison(
    expression: &str,
    operation: &str,
    operator: &str,
    operations: &Map<String, JsonValue>,
    clauses: &mut Vec<String>,
    parameters: &mut Vec<turso::Value>,
) -> NativeResult<()> {
    let Some(value) = operations.get(operation) else {
        return Ok(());
    };
    if !value.is_string() && !value.is_number() {
        return Err(invalid(&format!(
            "{operation} requires a string or number."
        )));
    }
    clauses.push(format!("{expression} {operator} ?"));
    parameters.push(parameter(value)?);
    Ok(())
}

fn compile_order(order: Option<&JsonValue>, search: bool) -> NativeResult<String> {
    let mut result = Vec::new();
    if let Some(order) = order {
        for item in order
            .as_array()
            .ok_or_else(|| invalid("order must be an array."))?
        {
            let item = item
                .as_object()
                .ok_or_else(|| invalid("order entries must be objects."))?;
            let field = item
                .get("field")
                .and_then(JsonValue::as_str)
                .ok_or_else(|| invalid("order field must be a string."))?;
            identifier(field)?;
            let direction = item
                .get("direction")
                .and_then(JsonValue::as_str)
                .unwrap_or("ascending");
            let direction = match direction {
                "ascending" => "ASC",
                "descending" => "DESC",
                _ => return Err(invalid("order direction must be ascending or descending.")),
            };
            result.push(format!("json_extract(record, '$.{field}') {direction}"));
        }
    }
    if search && result.is_empty() {
        result.push("score ASC".to_owned());
    }
    result.push("id ASC".to_owned());
    Ok(result.join(", "))
}

fn compile_pagination(
    query: &Map<String, JsonValue>,
    parameters: &mut Vec<turso::Value>,
) -> NativeResult<String> {
    let offset = optional_integer(query, "offset")?.unwrap_or(0);
    let limit = optional_integer(query, "limit")?;
    if offset < 0 || limit.is_some_and(|limit| limit < 0) {
        return Err(invalid("offset and limit must be non-negative."));
    }
    if limit.is_none() && offset == 0 {
        return Ok(String::new());
    }
    parameters.push(turso::Value::Integer(limit.unwrap_or(-1)));
    parameters.push(turso::Value::Integer(offset));
    Ok(" LIMIT ? OFFSET ?".to_owned())
}

fn parameter(value: &JsonValue) -> NativeResult<turso::Value> {
    match value {
        JsonValue::Null => Ok(turso::Value::Null),
        JsonValue::Bool(value) => Ok(turso::Value::Integer(i64::from(*value))),
        JsonValue::Number(value) => value
            .as_i64()
            .map(turso::Value::Integer)
            .or_else(|| value.as_f64().map(turso::Value::Real))
            .ok_or_else(|| invalid("query numbers must be finite.")),
        JsonValue::String(value) => Ok(turso::Value::Text(value.clone())),
        _ => Err(invalid(
            "query predicates support only numbers, strings, booleans, and null.",
        )),
    }
}

fn search_text(value: &str) -> String {
    let mut terms = Vec::new();
    let mut term = String::new();
    for character in value.chars() {
        if character.is_alphanumeric() || character == '_' {
            term.push(character);
        } else if !term.is_empty() {
            terms.push(std::mem::take(&mut term));
        }
    }
    if !term.is_empty() {
        terms.push(term);
    }
    terms
        .into_iter()
        .map(|term| format!("\"{term}\""))
        .collect::<Vec<_>>()
        .join(" ")
}

fn table(collection: &str) -> String {
    format!("kit_data_{}", hash(collection))
}

fn hash(value: &str) -> String {
    let mut result = 2_166_136_261_u32;
    for character in value.chars() {
        result ^= character as u32;
        result = result.wrapping_mul(16_777_619);
    }
    radix36(result)
}

fn radix36(mut value: u32) -> String {
    const DIGITS: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    if value == 0 {
        return "0".to_owned();
    }
    let mut result = Vec::new();
    while value > 0 {
        result.push(DIGITS[(value % 36) as usize]);
        value /= 36;
    }
    result.reverse();
    String::from_utf8(result).expect("radix characters")
}

fn identifier(value: &str) -> NativeResult<()> {
    let mut characters = value.chars();
    let valid_start = characters
        .next()
        .is_some_and(|character| character == '_' || character.is_ascii_alphabetic());
    if !valid_start
        || !characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
    {
        return Err(invalid(&format!("invalid portable field {value:?}.")));
    }
    Ok(())
}

fn string<'a>(input: &'a JsonValue, name: &str) -> NativeResult<&'a str> {
    input
        .get(name)
        .and_then(JsonValue::as_str)
        .ok_or_else(|| invalid(&format!("{name} must be a string.")))
}

fn integer(input: &JsonValue, name: &str) -> NativeResult<i64> {
    input
        .get(name)
        .and_then(JsonValue::as_i64)
        .ok_or_else(|| invalid(&format!("{name} must be an integer.")))
}

fn optional_integer(input: &Map<String, JsonValue>, name: &str) -> NativeResult<Option<i64>> {
    input
        .get(name)
        .map(|value| {
            value
                .as_i64()
                .ok_or_else(|| invalid(&format!("{name} must be an integer.")))
        })
        .transpose()
}

fn object<'a>(input: &'a JsonValue, name: &str) -> NativeResult<&'a Map<String, JsonValue>> {
    input
        .get(name)
        .and_then(JsonValue::as_object)
        .ok_or_else(|| invalid(&format!("{name} must be an object.")))
}

fn array<'a>(input: &'a JsonValue, name: &str) -> NativeResult<&'a Vec<JsonValue>> {
    input
        .get(name)
        .and_then(JsonValue::as_array)
        .ok_or_else(|| invalid(&format!("{name} must be an array.")))
}

fn string_array(input: &JsonValue, name: &str) -> NativeResult<Vec<String>> {
    array(input, name)?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid(&format!("{name} must contain strings.")))
        })
        .collect()
}

fn database_error(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("DataStoreFailure", error.to_string())
}

fn invalid(message: &str) -> NativeError {
    NativeError::new("InvalidInput", message)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn stores_filters_orders_and_searches_records() {
        let directory = tempdir().expect("temporary directory");
        let data = create(DependencyContext {
            name: "dataStore".to_owned(),
            configuration: BTreeMap::from([(
                "database".to_owned(),
                directory.path().join("data.turso").display().to_string(),
            )]),
            dependencies: BTreeMap::new(),
        })
        .await
        .expect("create data");
        let engine = Engine::new();
        data.call(
            engine.clone(),
            "replace",
            Value::from_json(&json!({
                "collection": "notes",
                "revision": 1,
                "records": [
                    { "id": "b", "title": "Distributed systems", "priority": 2, "archived": false },
                    { "id": "a", "title": "Portable systems", "priority": 1, "archived": false },
                    { "id": "c", "title": "Archived", "priority": 3, "archived": true }
                ],
                "indexes": ["priority", "archived"],
                "search": ["title"]
            })),
        )
        .await
        .expect("replace");
        let queried = data
            .call(
                engine.clone(),
                "query",
                Value::from_json(&json!({
                    "collection": "notes",
                    "query": {
                        "where": { "archived": false },
                        "order": [{ "field": "priority", "direction": "descending" }]
                    }
                })),
            )
            .await
            .expect("query")
            .to_json()
            .expect("JSON");
        assert_eq!(queried[0]["record"]["id"], "b");
        assert_eq!(queried[1]["record"]["id"], "a");

        let searched = data
            .call(
                engine,
                "query",
                Value::from_json(&json!({
                    "collection": "notes",
                    "query": { "text": "systems" }
                })),
            )
            .await
            .expect("search")
            .to_json()
            .expect("JSON");
        assert_eq!(searched.as_array().expect("array").len(), 2);
    }
}
