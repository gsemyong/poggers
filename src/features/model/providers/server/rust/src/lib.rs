use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};
use reqwest::{Client, StatusCode, Url};
use serde_json::{Value as JsonValue, json};

pub struct Model {
    client: Client,
    gateway: String,
    api_key: String,
    model: String,
}

pub async fn create(context: DependencyContext) -> NativeResult<Model> {
    let gateway = context
        .configuration("gateway")?
        .trim_end_matches('/')
        .to_owned();
    let api_key = context.configuration("apiKey")?.to_owned();
    let model = context.configuration("model")?.to_owned();
    if api_key.is_empty() {
        return Err(NativeError::new(
            "ConfigurationError",
            "AI_GATEWAY_API_KEY must not be empty.",
        ));
    }
    Ok(Model {
        client: Client::new(),
        gateway,
        api_key,
        model,
    })
}

impl Dependency for Model {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        if operation != "generate" {
            let operation = operation.to_owned();
            return Box::pin(async move {
                Err(NativeError::new(
                    "UnknownOperation",
                    format!("LanguageModel has no operation {operation:?}."),
                ))
            });
        }
        let client = self.client.clone();
        let gateway = self.gateway.clone();
        let api_key = self.api_key.clone();
        let default_model = self.model.clone();
        Box::pin(async move {
            let input = input.to_json()?;
            generate(&client, &gateway, &api_key, &default_model, &input).await
        })
    }
}

kit_server_runtime::dependency_operations!(Model {
    operation_generate => "generate",
});

pub struct RealtimeCredentials {
    client: Client,
    gateway: String,
    api_key: String,
    team: Option<String>,
}

pub async fn create_realtime_credentials(
    context: DependencyContext,
) -> NativeResult<RealtimeCredentials> {
    let gateway = context
        .configuration("gateway")?
        .trim_end_matches('/')
        .to_owned();
    let api_key = context.configuration("apiKey")?.to_owned();
    let team = context
        .configuration
        .get("team")
        .map(String::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if api_key.is_empty() {
        return Err(NativeError::new(
            "ConfigurationError",
            "AI_GATEWAY_API_KEY must not be empty.",
        ));
    }
    Ok(RealtimeCredentials {
        client: Client::new(),
        gateway,
        api_key,
        team,
    })
}

impl Dependency for RealtimeCredentials {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        if operation != "create" {
            let operation = operation.to_owned();
            return Box::pin(async move {
                Err(NativeError::new(
                    "UnknownOperation",
                    format!("RealtimeCredentials has no operation {operation:?}."),
                ))
            });
        }
        let client = self.client.clone();
        let gateway = self.gateway.clone();
        let api_key = self.api_key.clone();
        let team = self.team.clone();
        Box::pin(async move {
            let input = input.to_json()?;
            create_client_secret(&client, &gateway, &api_key, team.as_deref(), &input).await
        })
    }
}

kit_server_runtime::dependency_operations!(RealtimeCredentials {
    operation_create => "create",
});

async fn generate(
    client: &Client,
    gateway: &str,
    api_key: &str,
    default_model: &str,
    input: &JsonValue,
) -> NativeResult<Value> {
    let object = input
        .as_object()
        .ok_or_else(|| invalid("LanguageModel input must be an object."))?;
    let messages = object
        .get("messages")
        .and_then(JsonValue::as_array)
        .ok_or_else(|| invalid("LanguageModel messages must be an array."))?;
    let mut body = json!({
        "model": object
            .get("model")
            .and_then(JsonValue::as_str)
            .unwrap_or(default_model),
        "messages": messages,
    });
    let body_object = body.as_object_mut().expect("Gateway body is an object");
    if let Some(temperature) = object.get("temperature") {
        body_object.insert("temperature".to_owned(), temperature.clone());
    }
    if let Some(max_tokens) = object.get("maxTokens") {
        body_object.insert("max_tokens".to_owned(), max_tokens.clone());
    }
    if let Some(output) = object.get("output").and_then(JsonValue::as_object) {
        let name = output
            .get("name")
            .and_then(JsonValue::as_str)
            .ok_or_else(|| invalid("Structured model output name must be a string."))?;
        let schema = output
            .get("schema")
            .ok_or_else(|| invalid("Structured model output schema is required."))?;
        let mut json_schema = json!({
            "name": name,
            "strict": true,
            "schema": portable_json_schema(schema)?,
        });
        if let Some(description) = output.get("description") {
            json_schema
                .as_object_mut()
                .expect("JSON schema declaration is an object")
                .insert("description".to_owned(), description.clone());
        }
        body_object.insert(
            "response_format".to_owned(),
            json!({
                "type": "json_schema",
                "json_schema": json_schema,
            }),
        );
    }
    let response = client
        .post(format!("{gateway}/chat/completions"))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(gateway_error)?;
    let status = response.status();
    let text = response.text().await.map_err(gateway_error)?;
    if !status.is_success() {
        return Err(status_error(status, &text));
    }
    let value: JsonValue = serde_json::from_str(&text).map_err(gateway_error)?;
    let choice = value
        .get("choices")
        .and_then(JsonValue::as_array)
        .and_then(|choices| choices.first());
    let usage = value.get("usage");
    let content = choice
        .and_then(|entry| entry.get("message"))
        .and_then(|message| message.get("content"))
        .and_then(JsonValue::as_str)
        .unwrap_or("");
    let mut result = json!({
        "text": choice
            .and_then(|entry| entry.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(JsonValue::as_str)
            .unwrap_or(""),
        "finishReason": choice
            .and_then(|entry| entry.get("finish_reason"))
            .and_then(JsonValue::as_str)
            .unwrap_or("unknown"),
        "usage": {
            "inputTokens": usage
                .and_then(|entry| entry.get("prompt_tokens"))
                .and_then(JsonValue::as_u64)
                .unwrap_or(0),
            "outputTokens": usage
                .and_then(|entry| entry.get("completion_tokens"))
                .and_then(JsonValue::as_u64)
                .unwrap_or(0),
        },
    });
    if let Some(schema) = object
        .get("output")
        .and_then(JsonValue::as_object)
        .and_then(|output| output.get("schema"))
    {
        let structured: JsonValue = serde_json::from_str(content)
            .map_err(|_| invalid("Structured model output is not valid JSON."))?;
        if !matches_portable_schema(&structured, schema)? {
            return Err(invalid(
                "Structured model output does not satisfy its declared type.",
            ));
        }
        result
            .as_object_mut()
            .expect("LanguageModel result is an object")
            .insert("value".to_owned(), structured);
    }
    Ok(Value::from_json(&result))
}

fn portable_json_schema(schema: &JsonValue) -> NativeResult<JsonValue> {
    let object = schema
        .as_object()
        .ok_or_else(|| invalid("Portable type schema must be an object."))?;
    let kind = object
        .get("kind")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| invalid("Portable type schema kind must be a string."))?;
    match kind {
        "primitive" => Ok(match object.get("name").and_then(JsonValue::as_str) {
            Some("string") => json!({ "type": "string" }),
            Some("number") => json!({ "type": "number" }),
            Some("boolean") => json!({ "type": "boolean" }),
            Some("null") => json!({ "type": "null" }),
            Some(name) => {
                return Err(invalid(format!(
                    "Structured model output cannot contain primitive {name:?}."
                )));
            }
            None => return Err(invalid("Portable primitive schema requires a name.")),
        }),
        "literal" => {
            Ok(json!({ "const": object.get("value").cloned().unwrap_or(JsonValue::Null) }))
        }
        "array" => Ok(json!({
            "type": "array",
            "items": portable_json_schema(
                object
                    .get("element")
                    .ok_or_else(|| invalid("Portable array schema requires an element."))?,
            )?,
        })),
        "tuple" => {
            let elements = object
                .get("elements")
                .and_then(JsonValue::as_array)
                .ok_or_else(|| invalid("Portable tuple schema requires elements."))?;
            Ok(json!({
                "type": "array",
                "prefixItems": elements
                    .iter()
                    .map(portable_json_schema)
                    .collect::<NativeResult<Vec<_>>>()?,
                "minItems": elements.len(),
                "maxItems": elements.len(),
            }))
        }
        "union" => {
            let variants = object
                .get("variants")
                .and_then(JsonValue::as_array)
                .ok_or_else(|| invalid("Portable union schema requires variants."))?;
            let literals = variants
                .iter()
                .map(|variant| {
                    variant
                        .as_object()
                        .filter(|variant| {
                            variant.get("kind").and_then(JsonValue::as_str) == Some("literal")
                        })
                        .and_then(|variant| variant.get("value"))
                        .cloned()
                })
                .collect::<Option<Vec<_>>>();
            if let Some(values) = literals {
                return Ok(json!({ "enum": values }));
            }
            Ok(json!({
                "anyOf": variants
                    .iter()
                    .map(portable_json_schema)
                    .collect::<NativeResult<Vec<_>>>()?,
            }))
        }
        "record" => {
            let fields = object
                .get("fields")
                .and_then(JsonValue::as_array)
                .ok_or_else(|| invalid("Portable record schema requires fields."))?;
            let mut properties = serde_json::Map::new();
            let mut required = Vec::new();
            for field in fields {
                let field = field
                    .as_object()
                    .ok_or_else(|| invalid("Portable record field must be an object."))?;
                let name = field
                    .get("name")
                    .and_then(JsonValue::as_str)
                    .ok_or_else(|| invalid("Portable record field name must be a string."))?;
                properties.insert(
                    name.to_owned(),
                    portable_json_schema(
                        field
                            .get("type")
                            .ok_or_else(|| invalid("Portable record field type is required."))?,
                    )?,
                );
                if !field
                    .get("optional")
                    .and_then(JsonValue::as_bool)
                    .unwrap_or(false)
                {
                    required.push(JsonValue::String(name.to_owned()));
                }
            }
            Ok(json!({
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": false,
            }))
        }
        _ => Err(invalid(format!(
            "Unsupported portable type schema kind {kind:?}."
        ))),
    }
}

fn matches_portable_schema(value: &JsonValue, schema: &JsonValue) -> NativeResult<bool> {
    let object = schema
        .as_object()
        .ok_or_else(|| invalid("Portable type schema must be an object."))?;
    let kind = object
        .get("kind")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| invalid("Portable type schema kind must be a string."))?;
    match kind {
        "primitive" => Ok(match object.get("name").and_then(JsonValue::as_str) {
            Some("string") => value.is_string(),
            Some("number") => value.is_number(),
            Some("boolean") => value.is_boolean(),
            Some("null") => value.is_null(),
            Some(_) => false,
            None => return Err(invalid("Portable primitive schema requires a name.")),
        }),
        "literal" => Ok(object.get("value") == Some(value)),
        "array" => {
            let Some(values) = value.as_array() else {
                return Ok(false);
            };
            let element = object
                .get("element")
                .ok_or_else(|| invalid("Portable array schema requires an element."))?;
            for value in values {
                if !matches_portable_schema(value, element)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        "tuple" => {
            let values = match value.as_array() {
                Some(values) => values,
                None => return Ok(false),
            };
            let elements = object
                .get("elements")
                .and_then(JsonValue::as_array)
                .ok_or_else(|| invalid("Portable tuple schema requires elements."))?;
            if values.len() != elements.len() {
                return Ok(false);
            }
            for (value, element) in values.iter().zip(elements) {
                if !matches_portable_schema(value, element)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        "union" => {
            let variants = object
                .get("variants")
                .and_then(JsonValue::as_array)
                .ok_or_else(|| invalid("Portable union schema requires variants."))?;
            for variant in variants {
                if matches_portable_schema(value, variant)? {
                    return Ok(true);
                }
            }
            Ok(false)
        }
        "record" => {
            let Some(record) = value.as_object() else {
                return Ok(false);
            };
            let fields = object
                .get("fields")
                .and_then(JsonValue::as_array)
                .ok_or_else(|| invalid("Portable record schema requires fields."))?;
            if record.len() > fields.len() {
                return Ok(false);
            }
            for field in fields {
                let field = field
                    .as_object()
                    .ok_or_else(|| invalid("Portable record field must be an object."))?;
                let name = field
                    .get("name")
                    .and_then(JsonValue::as_str)
                    .ok_or_else(|| invalid("Portable record field name must be a string."))?;
                let optional = field
                    .get("optional")
                    .and_then(JsonValue::as_bool)
                    .unwrap_or(false);
                let Some(field_value) = record.get(name) else {
                    if optional {
                        continue;
                    }
                    return Ok(false);
                };
                if !matches_portable_schema(
                    field_value,
                    field
                        .get("type")
                        .ok_or_else(|| invalid("Portable record field type is required."))?,
                )? {
                    return Ok(false);
                }
            }
            for key in record.keys() {
                if !fields.iter().any(|field| {
                    field
                        .get("name")
                        .and_then(JsonValue::as_str)
                        .is_some_and(|name| name == key)
                }) {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        _ => Err(invalid(format!(
            "Unsupported portable type schema kind {kind:?}."
        ))),
    }
}

async fn create_client_secret(
    client: &Client,
    gateway: &str,
    api_key: &str,
    team: Option<&str>,
    input: &JsonValue,
) -> NativeResult<Value> {
    let object = input
        .as_object()
        .ok_or_else(|| invalid("RealtimeCredentials input must be an object."))?;
    let model = object
        .get("model")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| invalid("RealtimeCredentials model must be a string."))?;
    let mut body = json!({ "model": model });
    if let Some(expires_after) = object.get("expiresAfterSeconds") {
        body.as_object_mut()
            .expect("Realtime credential body is an object")
            .insert("expiresIn".to_owned(), expires_after.clone());
    }

    let mut secret_url = Url::parse(gateway).map_err(gateway_error)?;
    secret_url.set_path("/v1/realtime/client-secrets");
    secret_url.set_query(None);
    secret_url.set_fragment(None);
    let response = client
        .post(secret_url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(gateway_error)?;
    let status = response.status();
    let text = response.text().await.map_err(gateway_error)?;
    if !status.is_success() {
        return Err(status_error(status, &text));
    }
    let response: JsonValue = serde_json::from_str(&text).map_err(gateway_error)?;
    let token = response
        .get("token")
        .and_then(JsonValue::as_str)
        .ok_or_else(|| invalid("Vercel AI Gateway returned no realtime token."))?;

    let mut websocket_url = Url::parse(gateway).map_err(gateway_error)?;
    let scheme = match websocket_url.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => {
            return Err(invalid(format!(
                "Realtime gateway must use HTTP or HTTPS, received {other:?}."
            )));
        }
    };
    websocket_url
        .set_scheme(scheme)
        .map_err(|()| invalid("Realtime gateway scheme cannot be converted to WebSocket."))?;
    let path = format!(
        "{}/realtime-model",
        websocket_url.path().trim_end_matches('/')
    );
    websocket_url.set_path(&path);
    websocket_url
        .query_pairs_mut()
        .clear()
        .append_pair("ai-model-id", model);

    let mut protocols = vec![
        JsonValue::String("ai-gateway-realtime.v1".to_owned()),
        JsonValue::String(format!("ai-gateway-auth.{token}")),
    ];
    if let Some(team) = team {
        protocols.push(JsonValue::String(format!(
            "ai-gateway-team.{}",
            URL_SAFE_NO_PAD.encode(team)
        )));
    }
    let mut result = json!({
        "token": token,
        "url": websocket_url.as_str(),
        "protocols": protocols,
    });
    if let Some(expires_at) = response.get("expiresAt").filter(|value| !value.is_null()) {
        result
            .as_object_mut()
            .expect("Realtime credential result is an object")
            .insert("expiresAt".to_owned(), expires_at.clone());
    }
    Ok(Value::from_json(&result))
}

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::new("InvalidInput", message)
}

fn gateway_error(error: impl std::fmt::Display) -> NativeError {
    NativeError::new("GatewayError", error.to_string())
}

fn status_error(status: StatusCode, body: &str) -> NativeError {
    NativeError::new(
        "GatewayError",
        format!("Vercel AI Gateway returned {status}: {body}"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn websocket_url_preserves_gateway_path_and_encodes_model() {
        let mut url = Url::parse("https://ai-gateway.example/v4/ai").unwrap();
        url.set_scheme("wss").unwrap();
        let path = format!("{}/realtime-model", url.path().trim_end_matches('/'));
        url.set_path(&path);
        url.query_pairs_mut()
            .append_pair("ai-model-id", "openai/gpt-realtime-mini");
        assert_eq!(
            url.as_str(),
            "wss://ai-gateway.example/v4/ai/realtime-model?ai-model-id=openai%2Fgpt-realtime-mini"
        );
        assert_eq!(URL_SAFE_NO_PAD.encode("product team"), "cHJvZHVjdCB0ZWFt");
    }
}
