use std::{collections::HashSet, fmt::Write, path::Path};

use serde_json::Value;

pub struct WebDocument {
    html: String,
}

impl WebDocument {
    pub fn load(root: &Path) -> Result<Self, String> {
        let source = std::fs::read_to_string(root.join("document.ir.json"))
            .map_err(|error| format!("read web document: {error}"))?;
        let document: Value = serde_json::from_str(&source)
            .map_err(|error| format!("decode web document: {error}"))?;
        Ok(Self {
            html: render(&document)?,
        })
    }

    pub fn html(&self) -> &str {
        &self.html
    }
}

fn render(document: &Value) -> Result<String, String> {
    validate_keys(
        document,
        &[
            "entry",
            "language",
            "rendering",
            "root",
            "styles",
            "title",
            "version",
        ],
        "web document",
    )?;
    if document.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("unsupported web document version".to_owned());
    }
    if string(document, "rendering")? != "initial-state-ssr" {
        return Err("unsupported web document rendering mode".to_owned());
    }
    let language = string(document, "language")?;
    if language.is_empty()
        || language
            .chars()
            .any(|character| character.is_whitespace() || "\"'<>".contains(character))
    {
        return Err("invalid web document language".to_owned());
    }
    let entry = string(document, "entry")?;
    if !entry.starts_with('/') {
        return Err("web document entry must be absolute".to_owned());
    }
    let styles = document
        .get("styles")
        .and_then(Value::as_array)
        .ok_or_else(|| "web document styles must be an array".to_owned())?;
    let root = document
        .get("root")
        .and_then(Value::as_array)
        .ok_or_else(|| "web document root must be an array".to_owned())?;

    let mut output = String::from("<!doctype html><html lang=\"");
    escape_attribute(&mut output, language);
    output.push_str("\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\">");
    if !styles.is_empty() {
        output.push_str("<style data-poggers-ssr>");
        for style in styles {
            let style = style
                .as_str()
                .ok_or_else(|| "web document style must be a string".to_owned())?;
            if style.to_ascii_lowercase().contains("</style") {
                return Err("web document style cannot close the style element".to_owned());
            }
            output.push_str(style);
        }
        output.push_str("</style>");
    }
    output.push_str("<title>");
    escape_text(&mut output, string(document, "title")?);
    output.push_str(
        "</title></head><body><div id=\"app\" data-poggers-rendering=\"initial-state-ssr\">",
    );
    let mut identities = HashSet::new();
    for node in root {
        render_node(&mut output, node, &mut identities)?;
    }
    output.push_str("</div><script type=\"module\" src=\"");
    escape_attribute(&mut output, entry);
    output.push_str("\"></script></body></html>");
    Ok(output)
}

fn render_node(
    output: &mut String,
    node: &Value,
    identities: &mut HashSet<String>,
) -> Result<(), String> {
    let kind = string(node, "kind")?;
    let hydration = string(node, "hydration")?;
    if !valid_hydration(hydration) || !identities.insert(hydration.to_owned()) {
        return Err("invalid web hydration identity".to_owned());
    }
    if kind == "text" {
        validate_keys(node, &["hydration", "kind", "value"], "web text node")?;
        if !hydration.starts_with('t') {
            return Err("web text hydration identity must start with t".to_owned());
        }
        output.push_str("<!--poggers:");
        output.push_str(hydration);
        output.push_str("-->");
        escape_text(output, string(node, "value")?);
        return Ok(());
    }
    if kind != "element" {
        return Err(format!("unsupported web document node {kind}"));
    }
    validate_keys(
        node,
        &["attributes", "children", "hydration", "kind", "tag"],
        "web element node",
    )?;
    if !hydration.starts_with('e') {
        return Err("web element hydration identity must start with e".to_owned());
    }
    let tag = string(node, "tag")?;
    if !valid_name(tag, false) {
        return Err(format!("invalid web element {tag}"));
    }
    write!(output, "<{tag}").expect("write to String");
    let attributes = node
        .get("attributes")
        .and_then(Value::as_array)
        .ok_or_else(|| "web element attributes must be an array".to_owned())?;
    let mut names = HashSet::new();
    let mut hydration_attribute = None;
    for attribute in attributes {
        validate_keys(attribute, &["name", "value"], "web element attribute")?;
        let name = string(attribute, "name")?;
        if !valid_name(name, true) {
            return Err(format!("invalid web attribute {name}"));
        }
        let value = string(attribute, "value")?;
        if !names.insert(name) {
            return Err(format!("duplicate web attribute {name}"));
        }
        if name == "data-poggers-h" {
            hydration_attribute = Some(value);
        }
        output.push(' ');
        output.push_str(name);
        if !value.is_empty() {
            output.push_str("=\"");
            escape_attribute(output, value);
            output.push('"');
        }
    }
    if hydration_attribute != Some(hydration) {
        return Err(format!(
            "web element {hydration} has a mismatched hydration attribute"
        ));
    }
    output.push('>');
    let children = node
        .get("children")
        .and_then(Value::as_array)
        .ok_or_else(|| "web element children must be an array".to_owned())?;
    if is_void_element(tag) {
        return children
            .is_empty()
            .then_some(())
            .ok_or_else(|| format!("void web element {tag} cannot have children"));
    }
    for child in children {
        render_node(output, child, identities)?;
    }
    write!(output, "</{tag}>").expect("write to String");
    Ok(())
}

fn string<'a>(value: &'a Value, name: &str) -> Result<&'a str, String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("web document {name} must be a string"))
}

fn validate_keys(value: &Value, expected: &[&str], subject: &str) -> Result<(), String> {
    let object = value
        .as_object()
        .ok_or_else(|| format!("{subject} must be an object"))?;
    if object.len() != expected.len() || expected.iter().any(|name| !object.contains_key(*name)) {
        return Err(format!("{subject} has unsupported fields"));
    }
    Ok(())
}

fn valid_hydration(value: &str) -> bool {
    let mut characters = value.chars();
    matches!(characters.next(), Some('e' | 't'))
        && characters.clone().next().is_some()
        && characters.all(|character| character.is_ascii_digit())
}

fn valid_name(value: &str, attribute: bool) -> bool {
    let mut characters = value.chars();
    characters
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
        && characters.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || character == '-'
                || (attribute && matches!(character, '_' | '.' | ':'))
        })
}

fn is_void_element(value: &str) -> bool {
    matches!(
        value,
        "area"
            | "base"
            | "br"
            | "col"
            | "embed"
            | "hr"
            | "img"
            | "input"
            | "link"
            | "meta"
            | "source"
            | "track"
            | "wbr"
    )
}

fn escape_text(output: &mut String, value: &str) {
    escape(output, value, false);
}

fn escape_attribute(output: &mut String, value: &str) {
    escape(output, value, true);
}

fn escape(output: &mut String, value: &str, attribute: bool) {
    for character in value.chars() {
        match character {
            '&' => output.push_str("&amp;"),
            '<' => output.push_str("&lt;"),
            '>' => output.push_str("&gt;"),
            '"' if attribute => output.push_str("&quot;"),
            '\'' if attribute => output.push_str("&#39;"),
            _ => output.push(character),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn document() -> Value {
        json!({
            "version": 1,
            "rendering": "initial-state-ssr",
            "language": "en",
            "title": "A < B & C",
            "entry": "/app.js",
            "styles": [".root{color:red}"],
            "root": [{
                "kind": "element",
                "hydration": "e0",
                "tag": "main",
                "attributes": [
                    { "name": "class", "value": "root" },
                    { "name": "data-poggers-h", "value": "e0" }
                ],
                "children": [{ "kind": "text", "hydration": "t0", "value": "<script>&\"'" }]
            }]
        })
    }

    #[test]
    fn renders_and_escapes_the_versioned_document() {
        let rendered = render(&document()).expect("render document");
        assert!(rendered.contains("<title>A &lt; B &amp; C</title>"));
        assert!(rendered.contains("<!--poggers:t0-->&lt;script&gt;&amp;\"'"));
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_documents() {
        let mut style = document();
        style["styles"] = json!(["</style><script>"]);
        assert!(render(&style).is_err());

        let mut duplicate = document();
        duplicate["root"][0]["children"][0]["hydration"] = json!("e0");
        assert!(render(&duplicate).is_err());
    }
}
