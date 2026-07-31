use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};
use rusqlite::{Connection, OptionalExtension, params, params_from_iter, types::Value as SqlValue};
use serde_json::{Map, Value as JsonValue, json};

const RETAINED_CHANGES: i64 = 256;

pub struct ProjectionStore {
    database: Arc<Mutex<Connection>>,
}

pub async fn create(context: DependencyContext) -> NativeResult<ProjectionStore> {
    let path = context.configuration("database")?;
    if path != ":memory:"
        && let Some(parent) = Path::new(path).parent()
    {
        fs::create_dir_all(parent).map_err(|error| failure(error))?;
    }
    let database = Connection::open(path).map_err(failure)?;
    database
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS kit_projection_state (
               projection TEXT NOT NULL,
               version INTEGER NOT NULL,
               revision INTEGER NOT NULL,
               cursors TEXT NOT NULL,
               PRIMARY KEY (projection, version)
             ) STRICT;
             CREATE TABLE IF NOT EXISTS kit_projection_rows (
               projection TEXT NOT NULL,
               version INTEGER NOT NULL,
               row_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               value TEXT NOT NULL,
               PRIMARY KEY (projection, version, row_name, row_id)
             ) STRICT;
             CREATE INDEX IF NOT EXISTS kit_projection_rows_collection
               ON kit_projection_rows (projection, version, row_name, row_id);
             CREATE TABLE IF NOT EXISTS kit_projection_scalars (
               projection TEXT NOT NULL,
               version INTEGER NOT NULL,
               row_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               field TEXT NOT NULL,
               kind TEXT NOT NULL,
               text_value TEXT,
               number_value REAL,
               boolean_value INTEGER,
               PRIMARY KEY (projection, version, row_name, row_id, field)
             ) STRICT;
             CREATE INDEX IF NOT EXISTS kit_projection_scalars_text
               ON kit_projection_scalars
               (projection, version, row_name, field, kind, text_value, row_id);
             CREATE INDEX IF NOT EXISTS kit_projection_scalars_number
               ON kit_projection_scalars
               (projection, version, row_name, field, kind, number_value, row_id);
             CREATE INDEX IF NOT EXISTS kit_projection_scalars_boolean
               ON kit_projection_scalars
               (projection, version, row_name, field, kind, boolean_value, row_id);
             CREATE TABLE IF NOT EXISTS kit_projection_terms (
               projection TEXT NOT NULL,
               version INTEGER NOT NULL,
               row_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               field TEXT NOT NULL,
               term TEXT NOT NULL,
               PRIMARY KEY (projection, version, row_name, row_id, field, term)
             ) STRICT;
             CREATE INDEX IF NOT EXISTS kit_projection_terms_lookup
               ON kit_projection_terms
               (projection, version, row_name, field, term, row_id);
             CREATE TABLE IF NOT EXISTS kit_projection_geo (
               projection TEXT NOT NULL,
               version INTEGER NOT NULL,
               row_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               field TEXT NOT NULL,
               latitude REAL NOT NULL,
               longitude REAL NOT NULL,
               PRIMARY KEY (projection, version, row_name, row_id, field)
             ) STRICT;
             CREATE INDEX IF NOT EXISTS kit_projection_geo_latitude
               ON kit_projection_geo
               (projection, version, row_name, field, latitude, longitude, row_id);
             CREATE INDEX IF NOT EXISTS kit_projection_geo_longitude
               ON kit_projection_geo
               (projection, version, row_name, field, longitude, latitude, row_id);
             CREATE TABLE IF NOT EXISTS kit_projection_vectors (
               projection TEXT NOT NULL,
               version INTEGER NOT NULL,
               row_name TEXT NOT NULL,
               row_id TEXT NOT NULL,
               field TEXT NOT NULL,
               dimensions INTEGER NOT NULL,
               value TEXT NOT NULL,
               PRIMARY KEY (projection, version, row_name, row_id, field)
             ) STRICT;
             CREATE INDEX IF NOT EXISTS kit_projection_vectors_lookup
               ON kit_projection_vectors
               (projection, version, row_name, field, dimensions, row_id);
             CREATE TABLE IF NOT EXISTS kit_projection_changes (
               projection TEXT NOT NULL,
               version INTEGER NOT NULL,
               revision INTEGER NOT NULL,
               cursors TEXT NOT NULL,
               changes TEXT NOT NULL,
               PRIMARY KEY (projection, version, revision)
             ) STRICT;",
        )
        .map_err(failure)?;
    Ok(ProjectionStore {
        database: Arc::new(Mutex::new(database)),
    })
}

impl Dependency for ProjectionStore {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let database = self.database.clone();
        let operation = operation.to_owned();
        Box::pin(async move {
            let input = input.to_json()?;
            let output = match operation.as_str() {
                "load" => load_operation(&database, &input)?,
                "read" => read_operation(&database, &input)?,
                "commit" => match commit_operation(&database, &input)? {
                    Some(value) => value,
                    None => return Ok(Value::Undefined),
                },
                "changes" => changes_operation(&database, &input)?,
                "query" => query_operation(&database, &input)?,
                operation => {
                    return Err(NativeError::new(
                        "UnknownOperation",
                        format!("ProjectionStore has no operation {operation:?}."),
                    ));
                }
            };
            Ok(Value::from_json(&output))
        })
    }
}

kit_server_runtime::dependency_operations!(ProjectionStore {
    operation_load => "load",
    operation_read => "read",
    operation_commit => "commit",
    operation_changes => "changes",
    operation_query => "query",
});

fn load_operation(database: &Mutex<Connection>, input: &JsonValue) -> NativeResult<JsonValue> {
    let projection = text(input, "projection")?;
    let version = integer(input, "version")?;
    let row_names = strings(field(input, "rows")?)?;
    load(&lock(database), projection, version, &row_names)
}

fn load(
    database: &Connection,
    projection: &str,
    version: i64,
    row_names: &[String],
) -> NativeResult<JsonValue> {
    let metadata = database
        .query_row(
            "SELECT revision, cursors FROM kit_projection_state
             WHERE projection = ?1 AND version = ?2",
            params![projection, version],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(failure)?;
    let mut rows = Map::new();
    for name in row_names {
        rows.insert(name.clone(), JsonValue::Array(vec![]));
    }
    for name in row_names {
        let mut statement = database
            .prepare(
                "SELECT value FROM kit_projection_rows
                 WHERE projection = ?1 AND version = ?2 AND row_name = ?3 ORDER BY row_id",
            )
            .map_err(failure)?;
        let stored = statement
            .query_map(params![projection, version, name], |row| {
                row.get::<_, String>(0)
            })
            .map_err(failure)?;
        for value in stored {
            if let Some(JsonValue::Array(values)) = rows.get_mut(name) {
                values.push(serde_json::from_str(&value.map_err(failure)?).map_err(failure)?);
            }
        }
    }
    let (revision, cursors) = match metadata {
        Some((revision, cursors)) => (
            revision,
            serde_json::from_str::<JsonValue>(&cursors).map_err(failure)?,
        ),
        None => (0, json!({})),
    };
    Ok(json!({
        "revision": revision,
        "cursors": cursors,
        "rows": rows,
    }))
}

fn read_operation(database: &Mutex<Connection>, input: &JsonValue) -> NativeResult<JsonValue> {
    let projection = text(input, "projection")?;
    let version = integer(input, "version")?;
    let keys = object(field(input, "keys")?)?;
    let database = lock(database);
    let mut rows = Map::new();
    let mut statement = database
        .prepare(
            "SELECT value FROM kit_projection_rows
             WHERE projection = ?1 AND version = ?2 AND row_name = ?3 AND row_id = ?4",
        )
        .map_err(failure)?;
    for (row_name, row_keys) in keys {
        let mut values = vec![];
        for row_id in strings(row_keys)? {
            let value = statement
                .query_row(params![projection, version, row_name, row_id], |row| {
                    row.get::<_, String>(0)
                })
                .optional()
                .map_err(failure)?;
            if let Some(value) = value {
                values.push(serde_json::from_str(&value).map_err(failure)?);
            }
        }
        rows.insert(row_name.clone(), JsonValue::Array(values));
    }
    Ok(JsonValue::Object(rows))
}

fn commit_operation(
    database: &Mutex<Connection>,
    input: &JsonValue,
) -> NativeResult<Option<JsonValue>> {
    let projection = text(input, "projection")?;
    let version = integer(input, "version")?;
    let expected = integer(input, "expectedRevision")?;
    let cursors = field(input, "cursors")?;
    let invocations = array(field(input, "invocations")?)?;
    let changes = array(field(input, "changes")?)?;
    let mut database = lock(database);
    let transaction = database.transaction().map_err(failure)?;
    let current = transaction
        .query_row(
            "SELECT revision FROM kit_projection_state
             WHERE projection = ?1 AND version = ?2",
            params![projection, version],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(failure)?
        .unwrap_or(0);
    if current != expected {
        return Ok(None);
    }
    let revision = expected + 1;
    for change in changes {
        let row_name = text(change, "row")?;
        let row_id = text(change, "id")?;
        transaction
            .execute(
                "DELETE FROM kit_projection_scalars
                 WHERE projection = ?1 AND version = ?2 AND row_name = ?3 AND row_id = ?4",
                params![projection, version, row_name, row_id],
            )
            .map_err(failure)?;
        transaction
            .execute(
                "DELETE FROM kit_projection_terms
                 WHERE projection = ?1 AND version = ?2 AND row_name = ?3 AND row_id = ?4",
                params![projection, version, row_name, row_id],
            )
            .map_err(failure)?;
        transaction
            .execute(
                "DELETE FROM kit_projection_geo
                 WHERE projection = ?1 AND version = ?2 AND row_name = ?3 AND row_id = ?4",
                params![projection, version, row_name, row_id],
            )
            .map_err(failure)?;
        transaction
            .execute(
                "DELETE FROM kit_projection_vectors
                 WHERE projection = ?1 AND version = ?2 AND row_name = ?3 AND row_id = ?4",
                params![projection, version, row_name, row_id],
            )
            .map_err(failure)?;
        match change.get("after") {
            Some(after) if !after.is_null() => {
                transaction
                    .execute(
                        "INSERT INTO kit_projection_rows
                         (projection, version, row_name, row_id, value)
                         VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT (projection, version, row_name, row_id)
                         DO UPDATE SET value = excluded.value",
                        params![
                            projection,
                            version,
                            row_name,
                            row_id,
                            serde_json::to_string(after).map_err(failure)?
                        ],
                    )
                    .map_err(failure)?;
                index_scalars(&transaction, projection, version, row_name, row_id, after)?;
                index_terms(&transaction, projection, version, row_name, row_id, after)?;
                index_geo(&transaction, projection, version, row_name, row_id, after)?;
                index_vectors(&transaction, projection, version, row_name, row_id, after)?;
            }
            _ => {
                transaction
                    .execute(
                        "DELETE FROM kit_projection_rows
                         WHERE projection = ?1 AND version = ?2
                         AND row_name = ?3 AND row_id = ?4",
                        params![projection, version, row_name, row_id],
                    )
                    .map_err(failure)?;
            }
        }
    }
    let cursors_json = serde_json::to_string(cursors).map_err(failure)?;
    let changes_json = serde_json::to_string(&json!({
        "invocations": invocations,
        "changes": changes,
    }))
    .map_err(failure)?;
    transaction
        .execute(
            "INSERT INTO kit_projection_state (projection, version, revision, cursors)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (projection, version)
             DO UPDATE SET revision = excluded.revision, cursors = excluded.cursors",
            params![projection, version, revision, cursors_json],
        )
        .map_err(failure)?;
    transaction
        .execute(
            "INSERT INTO kit_projection_changes
             (projection, version, revision, cursors, changes)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![projection, version, revision, cursors_json, changes_json],
        )
        .map_err(failure)?;
    transaction
        .execute(
            "DELETE FROM kit_projection_changes
             WHERE projection = ?1 AND version = ?2 AND revision <= ?3",
            params![projection, version, (revision - RETAINED_CHANGES).max(0)],
        )
        .map_err(failure)?;
    transaction.commit().map_err(failure)?;
    Ok(Some(json!({
        "revision": revision,
        "cursors": cursors,
    })))
}

fn index_scalars(
    database: &Connection,
    projection: &str,
    version: i64,
    row_name: &str,
    row_id: &str,
    value: &JsonValue,
) -> NativeResult<()> {
    let record = object(value)?;
    let mut insert = database
        .prepare(
            "INSERT INTO kit_projection_scalars
             (projection, version, row_name, row_id, field, kind, text_value, number_value,
              boolean_value)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )
        .map_err(failure)?;
    for (field, item) in record {
        let (kind, text_value, number_value, boolean_value) = match item {
            JsonValue::Null => ("null", None, None, None),
            JsonValue::String(value) => ("string", Some(value.as_str()), None, None),
            JsonValue::Number(value) => ("number", None, value.as_f64(), None),
            JsonValue::Bool(value) => (
                "boolean",
                None,
                None,
                Some(if *value { 1_i64 } else { 0_i64 }),
            ),
            _ => continue,
        };
        insert
            .execute(params![
                projection,
                version,
                row_name,
                row_id,
                field,
                kind,
                text_value,
                number_value,
                boolean_value,
            ])
            .map_err(failure)?;
    }
    Ok(())
}

fn index_terms(
    database: &Connection,
    projection: &str,
    version: i64,
    row_name: &str,
    row_id: &str,
    value: &JsonValue,
) -> NativeResult<()> {
    let record = object(value)?;
    let mut insert = database
        .prepare(
            "INSERT INTO kit_projection_terms
             (projection, version, row_name, row_id, field, term)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(failure)?;
    for (field, item) in record {
        let Some(value) = item.as_str() else {
            continue;
        };
        for term in projection_text_terms(value) {
            insert
                .execute(params![projection, version, row_name, row_id, field, term])
                .map_err(failure)?;
        }
    }
    Ok(())
}

fn index_geo(
    database: &Connection,
    projection: &str,
    version: i64,
    row_name: &str,
    row_id: &str,
    value: &JsonValue,
) -> NativeResult<()> {
    let record = object(value)?;
    let mut insert = database
        .prepare(
            "INSERT INTO kit_projection_geo
             (projection, version, row_name, row_id, field, latitude, longitude)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(failure)?;
    for (field, item) in record {
        let Some(point) = item.as_object() else {
            continue;
        };
        let (Some(latitude), Some(longitude)) = (
            point.get("latitude").and_then(JsonValue::as_f64),
            point.get("longitude").and_then(JsonValue::as_f64),
        ) else {
            continue;
        };
        insert
            .execute(params![
                projection, version, row_name, row_id, field, latitude, longitude
            ])
            .map_err(failure)?;
    }
    Ok(())
}

fn index_vectors(
    database: &Connection,
    projection: &str,
    version: i64,
    row_name: &str,
    row_id: &str,
    value: &JsonValue,
) -> NativeResult<()> {
    let record = object(value)?;
    let mut insert = database
        .prepare(
            "INSERT INTO kit_projection_vectors
             (projection, version, row_name, row_id, field, dimensions, value)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .map_err(failure)?;
    for (field, item) in record {
        let Some(vector) = item.as_array() else {
            continue;
        };
        if vector.is_empty() || vector.iter().any(|entry| entry.as_f64().is_none()) {
            continue;
        }
        insert
            .execute(params![
                projection,
                version,
                row_name,
                row_id,
                field,
                vector.len() as i64,
                serde_json::to_string(vector).map_err(failure)?,
            ])
            .map_err(failure)?;
    }
    Ok(())
}

fn changes_operation(database: &Mutex<Connection>, input: &JsonValue) -> NativeResult<JsonValue> {
    let projection = text(input, "projection")?;
    let version = integer(input, "version")?;
    let after = integer(input, "after")?;
    let limit = integer(input, "limit")?;
    let database = lock(database);
    let mut statement = database
        .prepare(
            "SELECT revision, cursors, changes FROM kit_projection_changes
             WHERE projection = ?1 AND version = ?2 AND revision > ?3
             ORDER BY revision LIMIT ?4",
        )
        .map_err(failure)?;
    let values = statement
        .query_map(params![projection, version, after, limit], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(failure)?
        .map(|value| {
            let (revision, cursors, changes) = value.map_err(failure)?;
            let retained = serde_json::from_str::<JsonValue>(&changes).map_err(failure)?;
            Ok(json!({
                "revision": revision,
                "cursors": serde_json::from_str::<JsonValue>(&cursors).map_err(failure)?,
                "invocations": field(&retained, "invocations")?,
                "changes": field(&retained, "changes")?,
            }))
        })
        .collect::<NativeResult<Vec<_>>>()?;
    Ok(JsonValue::Array(values))
}

fn query_operation(database: &Mutex<Connection>, input: &JsonValue) -> NativeResult<JsonValue> {
    let projection = text(input, "projection")?;
    let version = integer(input, "version")?;
    let row_name = text(input, "row")?;
    let database = lock(database);
    let metadata = database
        .query_row(
            "SELECT revision, cursors FROM kit_projection_state
             WHERE projection = ?1 AND version = ?2",
            params![projection, version],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(failure)?;
    let scope = field(input, "scope")?;
    let query = field(input, "query")?;
    let selection = query.get("find").or_else(|| query.get("select"));
    let rows = indexed_rows(
        &database, projection, version, row_name, scope, selection, query,
    )?;
    let mut remaining = query.clone();
    if let Some(remaining) = remaining.as_object_mut() {
        remaining.remove("find");
        remaining.remove("select");
    }
    let (revision, cursors) = match metadata {
        Some((revision, cursors)) => (
            revision,
            serde_json::from_str::<JsonValue>(&cursors).map_err(failure)?,
        ),
        None => (0, json!({})),
    };
    evaluate(rows, &remaining, revision, cursors)
}

fn indexed_rows(
    database: &Connection,
    projection: &str,
    version: i64,
    row_name: &str,
    scope: &JsonValue,
    selection: Option<&JsonValue>,
    query: &JsonValue,
) -> NativeResult<Vec<JsonValue>> {
    let mut parameters = vec![
        SqlValue::Text(projection.to_owned()),
        SqlValue::Integer(version),
        SqlValue::Text(row_name.to_owned()),
    ];
    let identity = (projection, version, row_name);
    let authorized = indexed_selection_sql("source", scope, &mut parameters, identity)?;
    let common = "SELECT source.row_id, source.value FROM kit_projection_rows source
                  WHERE source.projection = ? AND source.version = ? AND source.row_name = ?";
    let mut ctes = vec![format!("authorized AS ({common}{authorized})")];
    let mut selected = "authorized";
    if let Some(selection) = selection {
        let query = indexed_selection_sql("candidate", selection, &mut parameters, identity)?;
        ctes.push(format!(
            "selected AS (
               SELECT candidate.row_id, candidate.value FROM authorized candidate
               WHERE 1 = 1{query}
             )"
        ));
        selected = "selected";
    }
    if let Some(analytics) = query.get("analytics") {
        let mut fields = BTreeSet::new();
        if let Some(group_by) = analytics.get("groupBy").and_then(JsonValue::as_array) {
            for field_name in group_by {
                fields.insert(
                    field_name
                        .as_str()
                        .ok_or_else(|| invalid("Projection analytics group field is invalid."))?
                        .to_owned(),
                );
            }
        }
        for measure in object(field(analytics, "measures")?)?.values() {
            for name in ["sum", "minimum", "maximum", "average"] {
                if let Some(field_name) = measure.get(name).and_then(JsonValue::as_str) {
                    fields.insert(field_name.to_owned());
                }
            }
        }
        parameters.extend([
            SqlValue::Text(projection.to_owned()),
            SqlValue::Integer(version),
            SqlValue::Text(row_name.to_owned()),
        ]);
        parameters.extend(fields.iter().cloned().map(SqlValue::Text));
        let field_filter = if fields.is_empty() {
            " AND 0 = 1".to_owned()
        } else {
            format!(
                " AND scalar.field IN ({})",
                fields.iter().map(|_| "?").collect::<Vec<_>>().join(", ")
            )
        };
        let sql = format!(
            "WITH {} SELECT candidate.row_id, scalar.field, scalar.kind, scalar.text_value,
             scalar.number_value, scalar.boolean_value FROM {selected} candidate
             LEFT JOIN kit_projection_scalars scalar
             ON scalar.projection = ? AND scalar.version = ? AND scalar.row_name = ?
             AND scalar.row_id = candidate.row_id{field_filter}
             ORDER BY candidate.row_id, scalar.field",
            ctes.join(", ")
        );
        let mut statement = database.prepare(&sql).map_err(failure)?;
        let values = statement
            .query_map(params_from_iter(parameters.iter()), |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            })
            .map_err(failure)?;
        let mut records: BTreeMap<String, Map<String, JsonValue>> = BTreeMap::new();
        for value in values {
            let (row_id, field_name, kind, text_value, number_value, boolean_value) =
                value.map_err(failure)?;
            let record = records
                .entry(row_id.clone())
                .or_insert_with(|| Map::from_iter([("id".to_owned(), json!(row_id))]));
            let (Some(field_name), Some(kind)) = (field_name, kind) else {
                continue;
            };
            let value = match kind.as_str() {
                "null" => JsonValue::Null,
                "string" => json!(text_value),
                "number" => json!(number_value),
                "boolean" => json!(boolean_value == Some(1)),
                _ => return Err(invalid("Projection indexed scalar kind is invalid.")),
            };
            record.insert(field_name, value);
        }
        return Ok(records.into_values().map(JsonValue::Object).collect());
    }
    if let Some(vector) = query.get("vector") {
        let field_name = text(vector, "field")?;
        let needle = numbers(field(vector, "value")?)?;
        parameters.extend([
            SqlValue::Text(projection.to_owned()),
            SqlValue::Integer(version),
            SqlValue::Text(row_name.to_owned()),
            SqlValue::Text(field_name.to_owned()),
            SqlValue::Integer(needle.len() as i64),
        ]);
        let sql = format!(
            "WITH {} SELECT candidate.row_id, stored.value
             FROM {selected} candidate
             JOIN kit_projection_vectors stored
             ON stored.projection = ? AND stored.version = ? AND stored.row_name = ?
             AND stored.row_id = candidate.row_id AND stored.field = ?
             AND stored.dimensions = ?
             ORDER BY candidate.row_id",
            ctes.join(", ")
        );
        let mut statement = database.prepare(&sql).map_err(failure)?;
        let candidates = statement
            .query_map(params_from_iter(parameters.iter()), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(failure)?
            .map(|candidate| {
                let (row_id, stored) = candidate.map_err(failure)?;
                let stored = serde_json::from_str::<JsonValue>(&stored).map_err(failure)?;
                Ok((row_id, vector_score(&numbers(&stored)?, &needle)))
            })
            .collect::<NativeResult<Vec<_>>>()?;
        let mut candidates = candidates;
        candidates.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.0.cmp(&right.0))
        });
        let limit = vector
            .get("limit")
            .and_then(JsonValue::as_u64)
            .unwrap_or(candidates.len() as u64) as usize;
        candidates.truncate(limit);
        let mut read = database
            .prepare(
                "SELECT value FROM kit_projection_rows
                 WHERE projection = ?1 AND version = ?2 AND row_name = ?3 AND row_id = ?4",
            )
            .map_err(failure)?;
        return candidates
            .into_iter()
            .map(|(row_id, _)| {
                let value = read
                    .query_row(params![projection, version, row_name, row_id], |row| {
                        row.get::<_, String>(0)
                    })
                    .map_err(failure)?;
                serde_json::from_str::<JsonValue>(&value).map_err(failure)
            })
            .collect();
    }
    let mut result = format!("SELECT value FROM {selected}");
    if let Some(text_query) = query.get("text") {
        let fields = strings(field(text_query, "fields")?)?;
        let terms = projection_text_terms(text(text_query, "value")?);
        if fields.is_empty() {
            result = format!("SELECT value FROM {selected} WHERE 0 = 1");
        } else if let Some(term) = terms.first() {
            parameters.extend([
                SqlValue::Text(projection.to_owned()),
                SqlValue::Integer(version),
                SqlValue::Text(row_name.to_owned()),
            ]);
            parameters.extend(fields.iter().cloned().map(SqlValue::Text));
            parameters.push(SqlValue::Text(term.clone()));
            result = format!(
                "SELECT DISTINCT candidate.value FROM {selected} candidate
                 JOIN kit_projection_terms term
                 ON term.projection = ? AND term.version = ? AND term.row_name = ?
                 AND term.row_id = candidate.row_id
                 WHERE term.field IN ({}) AND term.term = ?
                 ORDER BY candidate.row_id",
                fields.iter().map(|_| "?").collect::<Vec<_>>().join(", ")
            );
        }
    } else if let Some(graph) = query.get("graph") {
        let from = text(graph, "from")?;
        let to = text(graph, "to")?;
        push_scalar_identity(&mut parameters, identity, from);
        push_scalar_identity(&mut parameters, identity, to);
        ctes.push(format!(
            "edges AS (
               SELECT candidate.row_id, candidate.value, source.text_value AS source,
               target.text_value AS target FROM {selected} candidate
               JOIN kit_projection_scalars source
               ON source.projection = ? AND source.version = ? AND source.row_name = ?
               AND source.row_id = candidate.row_id AND source.field = ?
               AND source.kind = 'string'
               JOIN kit_projection_scalars target
               ON target.projection = ? AND target.version = ? AND target.row_name = ?
               AND target.row_id = candidate.row_id AND target.field = ?
               AND target.kind = 'string'
             )"
        ));
        let direction = graph
            .get("direction")
            .and_then(JsonValue::as_str)
            .unwrap_or("outgoing");
        let (join, destination) = match direction {
            "outgoing" => ("edges.source = walk.node", "edges.target"),
            "incoming" => ("edges.target = walk.node", "edges.source"),
            "both" => (
                "(edges.source = walk.node OR edges.target = walk.node)",
                "CASE WHEN edges.source = walk.node THEN edges.target ELSE edges.source END",
            ),
            _ => return Err(invalid("Projection graph direction is invalid.")),
        };
        parameters.push(SqlValue::Text(text(graph, "start")?.to_owned()));
        parameters.push(SqlValue::Integer(integer(graph, "depth")?));
        ctes.push(format!(
            "walk(edge_id, node, depth) AS (
               SELECT '' AS edge_id, ? AS node, 0 AS depth
               UNION SELECT edges.row_id, {destination}, walk.depth + 1
               FROM walk JOIN edges ON {join} WHERE walk.depth < ?
             )"
        ));
        result = "SELECT DISTINCT edges.value FROM walk JOIN edges ON edges.row_id = walk.edge_id
             WHERE walk.depth > 0 ORDER BY edges.row_id"
            .to_owned();
    } else if let Some(geo) = query.get("geo") {
        push_scalar_identity(&mut parameters, identity, text(geo, "field")?);
        let mut bounds = "";
        if let Some(within) = geo.get("within").and_then(JsonValue::as_f64) {
            let origin = field(geo, "origin")?;
            let latitude = number(origin, "latitude")?;
            let delta = within / 111_320.0;
            parameters.push(SqlValue::Real(latitude - delta));
            parameters.push(SqlValue::Real(latitude + delta));
            bounds = " AND point.latitude BETWEEN ? AND ?";
        }
        result = format!(
            "SELECT candidate.value FROM {selected} candidate
             JOIN kit_projection_geo point
             ON point.projection = ? AND point.version = ? AND point.row_name = ?
             AND point.row_id = candidate.row_id AND point.field = ?{bounds}
             ORDER BY candidate.row_id"
        );
    }
    let sql = format!("WITH RECURSIVE {} {result}", ctes.join(", "));
    let mut statement = database.prepare(&sql).map_err(failure)?;
    let rows = statement
        .query_map(params_from_iter(parameters.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(failure)?
        .map(|row| {
            let value = row.map_err(failure)?;
            serde_json::from_str::<JsonValue>(&value).map_err(failure)
        })
        .collect::<NativeResult<Vec<_>>>()?;
    Ok(rows)
}

fn indexed_selection_sql(
    alias: &str,
    selection: &JsonValue,
    parameters: &mut Vec<SqlValue>,
    identity: (&str, i64, &str),
) -> NativeResult<String> {
    let mut sql = String::new();
    if let Some(conditions) = selection.get("where").and_then(JsonValue::as_object) {
        for (field_name, condition) in conditions {
            if let Some(value) = condition.get("equal") {
                sql.push_str(&indexed_scalar_predicate(
                    alias, field_name, value, false, parameters, identity,
                )?);
            }
            if let Some(value) = condition.get("not") {
                sql.push_str(&indexed_scalar_predicate(
                    alias, field_name, value, true, parameters, identity,
                )?);
            }
            if let Some(values) = condition.get("oneOf").and_then(JsonValue::as_array) {
                if values.is_empty() {
                    sql.push_str(" AND 0 = 1");
                } else {
                    push_scalar_identity(parameters, identity, field_name);
                    let choices = values
                        .iter()
                        .map(|value| indexed_scalar_match(value, parameters))
                        .collect::<NativeResult<Vec<_>>>()?;
                    sql.push_str(&format!(
                        " AND EXISTS (
                           SELECT 1 FROM kit_projection_scalars scalar
                           WHERE scalar.projection = ? AND scalar.version = ?
                           AND scalar.row_name = ? AND scalar.row_id = {alias}.row_id
                           AND scalar.field = ? AND ({})
                         )",
                        choices.join(" OR ")
                    ));
                }
            }
            for (name, operator) in [
                ("greaterThan", ">"),
                ("atLeast", ">="),
                ("lessThan", "<"),
                ("atMost", "<="),
            ] {
                let Some(boundary) = condition.get(name) else {
                    continue;
                };
                push_scalar_identity(parameters, identity, field_name);
                parameters.push(sql_value(boundary)?);
                sql.push_str(&format!(
                    " AND EXISTS (
                       SELECT 1 FROM kit_projection_scalars scalar
                       WHERE scalar.projection = ? AND scalar.version = ?
                       AND scalar.row_name = ? AND scalar.row_id = {alias}.row_id
                       AND scalar.field = ? AND scalar.kind = 'number'
                       AND scalar.number_value {operator} ?
                     )"
                ));
            }
        }
    }
    let order = selection.get("order").and_then(JsonValue::as_array);
    if let Some(order) = order.filter(|order| !order.is_empty()) {
        let mut expressions = vec![];
        for item in order {
            let field_name = text(item, "field")?;
            push_scalar_identity(parameters, identity, field_name);
            let direction =
                if item.get("direction").and_then(JsonValue::as_str) == Some("descending") {
                    "DESC"
                } else {
                    "ASC"
                };
            expressions.push(format!(
                "(SELECT scalar.number_value FROM kit_projection_scalars scalar
                  WHERE scalar.projection = ? AND scalar.version = ?
                  AND scalar.row_name = ? AND scalar.row_id = {alias}.row_id
                  AND scalar.field = ? AND scalar.kind = 'number') {direction}"
            ));
        }
        sql.push_str(&format!(
            " ORDER BY {}, {alias}.row_id",
            expressions.join(", ")
        ));
    } else {
        sql.push_str(&format!(" ORDER BY {alias}.row_id"));
    }
    let limit = selection.get("limit").and_then(JsonValue::as_i64);
    let offset = selection.get("offset").and_then(JsonValue::as_i64);
    if let Some(limit) = limit {
        parameters.push(SqlValue::Integer(limit));
        sql.push_str(" LIMIT ?");
    } else if offset.is_some() {
        sql.push_str(" LIMIT -1");
    }
    if let Some(offset) = offset {
        parameters.push(SqlValue::Integer(offset));
        sql.push_str(" OFFSET ?");
    }
    Ok(sql)
}

fn indexed_scalar_predicate(
    alias: &str,
    field_name: &str,
    value: &JsonValue,
    negate: bool,
    parameters: &mut Vec<SqlValue>,
    identity: (&str, i64, &str),
) -> NativeResult<String> {
    push_scalar_identity(parameters, identity, field_name);
    let comparison = indexed_scalar_match(value, parameters)?;
    Ok(format!(
        " AND {}EXISTS (
           SELECT 1 FROM kit_projection_scalars scalar
           WHERE scalar.projection = ? AND scalar.version = ?
           AND scalar.row_name = ? AND scalar.row_id = {alias}.row_id
           AND scalar.field = ? AND {comparison}
         )",
        if negate { "NOT " } else { "" }
    ))
}

fn indexed_scalar_match(value: &JsonValue, parameters: &mut Vec<SqlValue>) -> NativeResult<String> {
    match value {
        JsonValue::Null => Ok("scalar.kind = 'null'".to_owned()),
        JsonValue::String(value) => {
            parameters.push(SqlValue::Text(value.clone()));
            Ok("scalar.kind = 'string' AND scalar.text_value = ?".to_owned())
        }
        JsonValue::Number(_) => {
            parameters.push(sql_value(value)?);
            Ok("scalar.kind = 'number' AND scalar.number_value = ?".to_owned())
        }
        JsonValue::Bool(value) => {
            parameters.push(SqlValue::Integer(if *value { 1 } else { 0 }));
            Ok("scalar.kind = 'boolean' AND scalar.boolean_value = ?".to_owned())
        }
        _ => Err(invalid("Projection scalar query value is not scalar.")),
    }
}

fn push_scalar_identity(
    parameters: &mut Vec<SqlValue>,
    identity: (&str, i64, &str),
    field_name: &str,
) {
    parameters.extend([
        SqlValue::Text(identity.0.to_owned()),
        SqlValue::Integer(identity.1),
        SqlValue::Text(identity.2.to_owned()),
        SqlValue::Text(field_name.to_owned()),
    ]);
}

fn sql_value(value: &JsonValue) -> NativeResult<SqlValue> {
    match value {
        JsonValue::Null => Ok(SqlValue::Null),
        JsonValue::String(value) => Ok(SqlValue::Text(value.clone())),
        JsonValue::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .ok_or_else(|| invalid("Projection number is not finite.")),
        JsonValue::Bool(value) => Ok(SqlValue::Integer(if *value { 1 } else { 0 })),
        _ => Err(invalid("Projection query value is not scalar.")),
    }
}

fn select(mut rows: Vec<JsonValue>, query: &JsonValue) -> NativeResult<Vec<JsonValue>> {
    let where_clause = query.get("where").and_then(JsonValue::as_object);
    rows.retain(|row| {
        where_clause.is_none_or(|conditions| {
            conditions.iter().all(|(name, condition)| {
                matches_condition(row.get(name).unwrap_or(&JsonValue::Null), condition)
            })
        })
    });
    if let Some(order) = query.get("order").and_then(JsonValue::as_array) {
        rows.sort_by(|left, right| {
            for field_order in order {
                let Some(name) = field_order.get("field").and_then(JsonValue::as_str) else {
                    continue;
                };
                let direction = if field_order.get("direction").and_then(JsonValue::as_str)
                    == Some("descending")
                {
                    Ordering::Greater
                } else {
                    Ordering::Less
                };
                let current = compare_json(
                    left.get(name).unwrap_or(&JsonValue::Null),
                    right.get(name).unwrap_or(&JsonValue::Null),
                );
                if current != Ordering::Equal {
                    return if direction == Ordering::Greater {
                        current.reverse()
                    } else {
                        current
                    };
                }
            }
            Ordering::Equal
        });
    }
    let offset = query.get("offset").and_then(JsonValue::as_u64).unwrap_or(0) as usize;
    let limit = query
        .get("limit")
        .and_then(JsonValue::as_u64)
        .unwrap_or(rows.len() as u64) as usize;
    Ok(rows.into_iter().skip(offset).take(limit).collect())
}

fn matches_condition(value: &JsonValue, condition: &JsonValue) -> bool {
    let equal = condition
        .get("equal")
        .is_none_or(|expected| value == expected);
    let not = condition
        .get("not")
        .is_none_or(|expected| value != expected);
    let one_of = condition
        .get("oneOf")
        .and_then(JsonValue::as_array)
        .is_none_or(|values| values.iter().any(|expected| value == expected));
    let number = value.as_f64().unwrap_or(0.0);
    equal
        && not
        && one_of
        && condition
            .get("greaterThan")
            .and_then(JsonValue::as_f64)
            .is_none_or(|expected| number > expected)
        && condition
            .get("atLeast")
            .and_then(JsonValue::as_f64)
            .is_none_or(|expected| number >= expected)
        && condition
            .get("lessThan")
            .and_then(JsonValue::as_f64)
            .is_none_or(|expected| number < expected)
        && condition
            .get("atMost")
            .and_then(JsonValue::as_f64)
            .is_none_or(|expected| number <= expected)
}

fn evaluate(
    rows: Vec<JsonValue>,
    query: &JsonValue,
    revision: i64,
    cursors: JsonValue,
) -> NativeResult<JsonValue> {
    let selection = query
        .get("find")
        .or_else(|| query.get("select"))
        .unwrap_or(&JsonValue::Null);
    let selected = select(rows, selection)?;
    let mut output = Map::from_iter([
        ("kind".to_owned(), json!("rows")),
        ("observations".to_owned(), cursors),
    ]);
    if revision > 0 {
        output.insert("revision".to_owned(), json!(revision));
        output.insert("cursor".to_owned(), json!(revision.to_string()));
    }
    if let Some(analytics) = query.get("analytics") {
        output.insert("kind".to_owned(), json!("analytics"));
        output.insert("groups".to_owned(), analytics_groups(&selected, analytics)?);
        return Ok(JsonValue::Object(output));
    }
    let matches = if let Some(text_query) = query.get("text") {
        text_matches(&selected, text_query)?
    } else if let Some(vector_query) = query.get("vector") {
        vector_matches(&selected, vector_query)?
    } else if let Some(graph_query) = query.get("graph") {
        graph_matches(&selected, graph_query)?
    } else if let Some(geo_query) = query.get("geo") {
        geo_matches(&selected, geo_query)?
    } else {
        selected
            .into_iter()
            .map(|row| json!({ "row": row }))
            .collect()
    };
    output.insert("matches".to_owned(), JsonValue::Array(matches));
    Ok(JsonValue::Object(output))
}

fn text_matches(rows: &[JsonValue], query: &JsonValue) -> NativeResult<Vec<JsonValue>> {
    let expected = projection_text_terms(text(query, "value")?);
    let fields = strings(field(query, "fields")?)?;
    let mut matches = vec![];
    for row in rows {
        let score = fields
            .iter()
            .filter(|field| {
                row.get(*field)
                    .and_then(JsonValue::as_str)
                    .is_some_and(|value| {
                        let available = projection_text_terms(value);
                        expected.iter().all(|term| available.contains(term))
                    })
            })
            .count();
        if score > 0 {
            matches.push(json!({ "row": row, "score": score }));
        }
    }
    matches.sort_by(|left, right| right["score"].as_u64().cmp(&left["score"].as_u64()));
    Ok(matches)
}

fn projection_text_terms(value: &str) -> Vec<String> {
    let mut terms = BTreeSet::new();
    let mut current = String::new();
    for character in value.to_lowercase().chars() {
        if character.is_ascii_alphanumeric() {
            current.push(character);
        } else if !current.is_empty() {
            terms.insert(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        terms.insert(current);
    }
    terms.into_iter().collect()
}

fn vector_matches(rows: &[JsonValue], query: &JsonValue) -> NativeResult<Vec<JsonValue>> {
    let field_name = text(query, "field")?;
    let needle = numbers(field(query, "value")?)?;
    let mut matches = vec![];
    for row in rows {
        let vector = numbers(
            row.get(field_name)
                .ok_or_else(|| invalid(format!("Vector field {field_name:?} is absent.")))?,
        )?;
        let score = vector_score(&vector, &needle);
        matches.push(json!({ "row": row, "score": score }));
    }
    matches.sort_by(|left, right| {
        right["score"]
            .as_f64()
            .partial_cmp(&left["score"].as_f64())
            .unwrap_or(Ordering::Equal)
    });
    let limit = query
        .get("limit")
        .and_then(JsonValue::as_u64)
        .unwrap_or(matches.len() as u64) as usize;
    matches.truncate(limit);
    Ok(matches)
}

fn vector_score(left: &[f64], right: &[f64]) -> f64 {
    let mut dot = 0.0;
    let mut left_magnitude = 0.0;
    let mut right_magnitude = 0.0;
    for (index, value) in right.iter().enumerate() {
        let candidate = left.get(index).copied().unwrap_or(0.0);
        dot += candidate * value;
        left_magnitude += candidate * candidate;
        right_magnitude += value * value;
    }
    if left_magnitude == 0.0 || right_magnitude == 0.0 {
        0.0
    } else {
        dot / (left_magnitude * right_magnitude).sqrt()
    }
}

fn graph_matches(rows: &[JsonValue], query: &JsonValue) -> NativeResult<Vec<JsonValue>> {
    let from = text(query, "from")?;
    let to = text(query, "to")?;
    let mut frontier = BTreeSet::from([text(query, "start")?.to_owned()]);
    let mut visited = frontier.clone();
    let direction = query
        .get("direction")
        .and_then(JsonValue::as_str)
        .unwrap_or("outgoing");
    let maximum = integer(query, "depth")?;
    let mut matches = vec![];
    for depth in 1..=maximum {
        let mut next = BTreeSet::new();
        for row in rows {
            let left = text(row, from)?;
            let right = text(row, to)?;
            let outgoing = frontier.contains(left);
            let incoming = frontier.contains(right);
            if (direction == "outgoing" && outgoing)
                || (direction == "incoming" && incoming)
                || (direction == "both" && (outgoing || incoming))
            {
                matches.push(json!({ "row": row, "distance": depth }));
                let destination = if outgoing { right } else { left };
                if visited.insert(destination.to_owned()) {
                    next.insert(destination.to_owned());
                }
            }
        }
        frontier = next;
    }
    Ok(matches)
}

fn geo_matches(rows: &[JsonValue], query: &JsonValue) -> NativeResult<Vec<JsonValue>> {
    let field_name = text(query, "field")?;
    let origin = field(query, "origin")?;
    let origin_latitude = number(origin, "latitude")?;
    let origin_longitude = number(origin, "longitude")?;
    let within = query.get("within").and_then(JsonValue::as_f64);
    let mut matches = vec![];
    for row in rows {
        let point = row
            .get(field_name)
            .ok_or_else(|| invalid(format!("Geo field {field_name:?} is absent.")))?;
        let point_latitude = number(point, "latitude")?;
        let point_longitude = number(point, "longitude")?;
        let latitude = (point_latitude - origin_latitude) * 111_320.0;
        let middle_latitude =
            ((point_latitude + origin_latitude) * 0.5 * std::f64::consts::PI) / 180.0;
        let longitude = (point_longitude - origin_longitude) * 111_320.0 * middle_latitude.cos();
        let distance = (latitude * latitude + longitude * longitude).sqrt();
        if within.is_none_or(|maximum| distance <= maximum) {
            matches.push(json!({ "row": row, "distance": distance }));
        }
    }
    matches.sort_by(|left, right| {
        left["distance"]
            .as_f64()
            .partial_cmp(&right["distance"].as_f64())
            .unwrap_or(Ordering::Equal)
    });
    let limit = query
        .get("limit")
        .and_then(JsonValue::as_u64)
        .unwrap_or(matches.len() as u64) as usize;
    matches.truncate(limit);
    Ok(matches)
}

fn analytics_groups(rows: &[JsonValue], query: &JsonValue) -> NativeResult<JsonValue> {
    let group_by = query
        .get("groupBy")
        .map(strings)
        .transpose()?
        .unwrap_or_default();
    let measures = object(field(query, "measures")?)?;
    let mut groups: BTreeMap<String, (Map<String, JsonValue>, Vec<&JsonValue>)> = BTreeMap::new();
    for row in rows {
        let mut key = Map::new();
        for field_name in &group_by {
            key.insert(
                field_name.clone(),
                row.get(field_name).cloned().unwrap_or(JsonValue::Null),
            );
        }
        let encoded = serde_json::to_string(&key).map_err(failure)?;
        groups
            .entry(encoded)
            .or_insert_with(|| (key, vec![]))
            .1
            .push(row);
    }
    let mut output = vec![];
    for (_, (key, rows)) in groups {
        let mut values = Map::new();
        for (name, measure) in measures {
            let value = if measure.get("count") == Some(&JsonValue::Bool(true)) {
                rows.len() as f64
            } else {
                let field_name = ["sum", "minimum", "maximum", "average"]
                    .into_iter()
                    .find_map(|candidate| {
                        measure
                            .get(candidate)
                            .and_then(JsonValue::as_str)
                            .map(|field| (candidate, field))
                    })
                    .ok_or_else(|| invalid("Analytical measure is invalid."))?;
                let numbers = rows
                    .iter()
                    .map(|row| {
                        row.get(field_name.1)
                            .and_then(JsonValue::as_f64)
                            .unwrap_or(0.0)
                    })
                    .collect::<Vec<_>>();
                match field_name.0 {
                    "sum" => numbers.iter().sum(),
                    "minimum" => numbers.iter().copied().reduce(f64::min).unwrap_or(0.0),
                    "maximum" => numbers.iter().copied().reduce(f64::max).unwrap_or(0.0),
                    _ => numbers.iter().sum::<f64>() / numbers.len().max(1) as f64,
                }
            };
            values.insert(name.clone(), json!(value));
        }
        output.push(json!({ "key": key, "measures": values }));
    }
    Ok(JsonValue::Array(output))
}

fn field<'a>(value: &'a JsonValue, name: &str) -> NativeResult<&'a JsonValue> {
    value
        .get(name)
        .ok_or_else(|| invalid(format!("ProjectionStore input requires {name:?}.")))
}

fn text<'a>(value: &'a JsonValue, name: &str) -> NativeResult<&'a str> {
    field(value, name)?
        .as_str()
        .ok_or_else(|| invalid(format!("ProjectionStore field {name:?} must be text.")))
}

fn integer(value: &JsonValue, name: &str) -> NativeResult<i64> {
    field(value, name)?.as_i64().ok_or_else(|| {
        invalid(format!(
            "ProjectionStore field {name:?} must be an integer."
        ))
    })
}

fn number(value: &JsonValue, name: &str) -> NativeResult<f64> {
    field(value, name)?
        .as_f64()
        .ok_or_else(|| invalid(format!("ProjectionStore field {name:?} must be a number.")))
}

fn array(value: &JsonValue) -> NativeResult<&Vec<JsonValue>> {
    value
        .as_array()
        .ok_or_else(|| invalid("ProjectionStore value must be an array."))
}

fn object(value: &JsonValue) -> NativeResult<&Map<String, JsonValue>> {
    value
        .as_object()
        .ok_or_else(|| invalid("ProjectionStore value must be an object."))
}

fn strings(value: &JsonValue) -> NativeResult<Vec<String>> {
    array(value)?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| invalid("ProjectionStore array value must be text."))
        })
        .collect()
}

fn numbers(value: &JsonValue) -> NativeResult<Vec<f64>> {
    array(value)?
        .iter()
        .map(|value| {
            value
                .as_f64()
                .ok_or_else(|| invalid("ProjectionStore array value must be a number."))
        })
        .collect()
}

fn compare_json(left: &JsonValue, right: &JsonValue) -> Ordering {
    match (left, right) {
        (JsonValue::Number(left), JsonValue::Number(right)) => left
            .as_f64()
            .partial_cmp(&right.as_f64())
            .unwrap_or(Ordering::Equal),
        (JsonValue::String(left), JsonValue::String(right)) => left.cmp(right),
        (JsonValue::Bool(left), JsonValue::Bool(right)) => left.cmp(right),
        _ => Ordering::Equal,
    }
}

fn lock(database: &Mutex<Connection>) -> MutexGuard<'_, Connection> {
    database.lock().unwrap_or_else(|error| error.into_inner())
}

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::new("InvalidInput", message)
}

fn failure(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("ProjectionStoreFailure", error.to_string())
}
