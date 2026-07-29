use std::collections::BTreeSet;

use chrono::{Datelike, LocalResult, NaiveDate, TimeZone, Utc};
use chrono_tz::Tz;
use kit_server_runtime::{
    Dependency, DependencyContext, DependencyInvocation, Engine, NativeError, NativeFuture,
    NativeResult, Value,
};
use serde_json::{Map, Value as JsonValue, json};

const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;
const MAX_SEARCH_DAYS: usize = 146_400;

pub struct Calendar;

pub async fn create(_context: DependencyContext) -> NativeResult<Calendar> {
    Ok(Calendar)
}

impl Dependency for Calendar {
    fn call(
        &self,
        _engine: Engine,
        operation: &str,
        input: Value,
        _invocation: DependencyInvocation,
    ) -> NativeFuture<Value> {
        let operation = operation.to_owned();
        Box::pin(async move {
            match operation.as_str() {
                "next" => next(input),
                operation => Err(NativeError::new(
                    "UnknownOperation",
                    format!("Calendar has no operation {operation:?}."),
                )),
            }
        })
    }
}

kit_server_runtime::dependency_operations!(Calendar {
    operation_next => "next",
});

#[derive(Clone)]
struct Fields {
    second: Vec<i32>,
    minute: Vec<i32>,
    hour: Vec<i32>,
    day_of_month: Vec<i32>,
    month: Vec<i32>,
    year: Vec<i32>,
    day_of_week: Vec<i32>,
}

fn next(input: Value) -> NativeResult<Value> {
    let input = input.to_json()?;
    let input = object(&input, "Calendar input")?;
    let after = integer(required(input, "after")?, "after")?;
    let through = integer(required(input, "through")?, "through")?;
    if through < after {
        return Err(invalid(
            "Calendar bounds must be ordered integer milliseconds.",
        ));
    }
    let time_zone = string(required(input, "timeZone")?, "timeZone")?;
    if time_zone.is_empty() {
        return Err(invalid("Calendar timeZone must be non-empty."));
    }
    let pattern = object(required(input, "pattern")?, "pattern")?;
    let calendar = pattern.get("calendar");
    let cron = pattern.get("cron");
    if calendar.is_some() == cron.is_some() {
        return Err(invalid(
            "Calendar pattern must contain exactly one of calendar or cron.",
        ));
    }
    let (zone, fields) = if let Some(expression) = cron {
        let (override_zone, fields) = parse_cron(string(expression, "cron")?)?;
        (override_zone.unwrap_or(time_zone), fields)
    } else {
        (
            time_zone,
            normalize_calendar(object(calendar.expect("checked"), "calendar")?)?,
        )
    };
    let zone = zone
        .parse::<Tz>()
        .map_err(|error| invalid(format!("Invalid Calendar timeZone: {error}")))?;
    match next_match(&fields, zone, after, through)? {
        Some(at) => Ok(Value::from_json(&json!({ "at": at }))),
        None => Ok(Value::Undefined),
    }
}

fn next_match(fields: &Fields, zone: Tz, after: i64, through: i64) -> NativeResult<Option<i64>> {
    let start = Utc
        .timestamp_millis_opt(after)
        .single()
        .ok_or_else(|| invalid("Calendar lower bound is outside the supported time range."))?
        .with_timezone(&zone)
        .date_naive();
    let finish = Utc
        .timestamp_millis_opt(through)
        .single()
        .ok_or_else(|| invalid("Calendar upper bound is outside the supported time range."))?
        .with_timezone(&zone)
        .date_naive();
    let final_date = finish.succ_opt().unwrap_or(finish);
    let mut date = start;
    for _ in 0..MAX_SEARCH_DAYS {
        if date > final_date {
            return Ok(None);
        }
        if matches_date(fields, date) {
            let mut best = None;
            for hour in &fields.hour {
                for minute in &fields.minute {
                    for second in &fields.second {
                        let Some(local) =
                            date.and_hms_opt(*hour as u32, *minute as u32, *second as u32)
                        else {
                            continue;
                        };
                        let mut candidates = match zone.from_local_datetime(&local) {
                            LocalResult::Single(value) => vec![value.timestamp_millis()],
                            LocalResult::Ambiguous(first, second) => {
                                vec![first.timestamp_millis(), second.timestamp_millis()]
                            }
                            LocalResult::None => Vec::new(),
                        };
                        candidates.sort_unstable();
                        for instant in candidates {
                            if instant > after
                                && instant <= through
                                && best.is_none_or(|current| instant < current)
                            {
                                best = Some(instant);
                            }
                        }
                    }
                }
            }
            if best.is_some() {
                return Ok(best);
            }
        }
        let Some(next) = date.succ_opt() else {
            return Ok(None);
        };
        date = next;
    }
    Err(NativeError::new(
        "CalendarSearchLimit",
        "Calendar search exceeds four hundred years.",
    ))
}

fn matches_date(fields: &Fields, date: NaiveDate) -> bool {
    includes(&fields.year, date.year())
        && includes(&fields.month, date.month() as i32)
        && includes(&fields.day_of_month, date.day() as i32)
        && includes(
            &fields.day_of_week,
            date.weekday().num_days_from_sunday() as i32,
        )
}

fn includes(values: &[i32], value: i32) -> bool {
    values.binary_search(&value).is_ok()
}

fn normalize_calendar(input: &Map<String, JsonValue>) -> NativeResult<Fields> {
    Ok(Fields {
        second: calendar_field(input.get("second"), 0, 59, None, Some(&[0]), false)?,
        minute: calendar_field(input.get("minute"), 0, 59, None, Some(&[0]), false)?,
        hour: calendar_field(input.get("hour"), 0, 23, None, Some(&[0]), false)?,
        day_of_month: calendar_field(input.get("dayOfMonth"), 1, 31, None, None, false)?,
        month: calendar_field(input.get("month"), 1, 12, Some(month), None, false)?,
        year: calendar_field(input.get("year"), 1, 9_999, None, None, false)?,
        day_of_week: calendar_field(input.get("dayOfWeek"), 0, 6, Some(weekday), None, true)?,
    })
}

fn calendar_field(
    value: Option<&JsonValue>,
    minimum: i32,
    maximum: i32,
    alias: Option<fn(&str) -> Option<i32>>,
    default: Option<&[i32]>,
    sunday_alias: bool,
) -> NativeResult<Vec<i32>> {
    if value.is_none()
        && let Some(default) = default
    {
        return Ok(default.to_vec());
    }
    if value.is_none() || value == Some(&JsonValue::String("*".to_owned())) {
        return Ok((minimum..=maximum).collect());
    }
    let values = match value.expect("checked") {
        JsonValue::Array(values) => values.as_slice(),
        value => std::slice::from_ref(value),
    };
    let mut selected = BTreeSet::new();
    for value in values {
        let (start_value, end_value, step) = if let JsonValue::Object(range) = value {
            (
                required(range, "start")?,
                range
                    .get("end")
                    .unwrap_or_else(|| required(range, "start").expect("checked")),
                range
                    .get("step")
                    .map(|value| integer(value, "step"))
                    .transpose()?
                    .unwrap_or(1),
            )
        } else {
            (value, value, 1)
        };
        if step < 1 {
            return Err(invalid("Calendar field step must be a positive integer."));
        }
        let start = field_unit(start_value, alias)?;
        let end = field_unit(end_value, alias)?;
        let allowed_maximum = if sunday_alias { maximum + 1 } else { maximum };
        if start < minimum || end > allowed_maximum || end < start {
            return Err(invalid(format!(
                "Calendar field must be between {minimum} and {maximum}."
            )));
        }
        let mut current = start;
        while current <= end {
            selected.insert(if sunday_alias && current == 7 {
                0
            } else {
                current
            });
            current = current
                .checked_add(step as i32)
                .ok_or_else(|| invalid("Calendar field step overflowed."))?;
        }
    }
    if selected.is_empty() {
        return Err(invalid("Calendar field cannot be empty."));
    }
    Ok(selected.into_iter().collect())
}

fn parse_cron(expression: &str) -> NativeResult<(Option<&str>, Fields)> {
    let mut source = expression.split('#').next().unwrap_or_default().trim();
    if source.is_empty() {
        return Err(invalid("Cron expression must be non-empty."));
    }
    let mut time_zone = None;
    if let Some((prefix, rest)) = source.split_once(char::is_whitespace)
        && (prefix.starts_with("CRON_TZ=") || prefix.starts_with("TZ="))
    {
        time_zone = prefix.split_once('=').map(|(_, value)| value);
        source = rest.trim();
    }
    source = match source.to_ascii_lowercase().as_str() {
        "@yearly" | "@annually" => "0 0 1 1 *",
        "@monthly" => "0 0 1 * *",
        "@weekly" => "0 0 * * 0",
        "@daily" | "@midnight" => "0 0 * * *",
        "@hourly" => "0 * * * *",
        _ => source,
    };
    let source_fields: Vec<&str> = source.split_whitespace().collect();
    let expanded: Vec<&str> = match source_fields.len() {
        5 => {
            let mut fields = vec!["0"];
            fields.extend(source_fields);
            fields.push("*");
            fields
        }
        6 => {
            let mut fields = vec!["0"];
            fields.extend(source_fields);
            fields
        }
        7 => source_fields,
        _ => return Err(invalid("Cron must contain five, six, or seven fields.")),
    };
    Ok((
        time_zone,
        Fields {
            second: parse_cron_field(expanded[0], 0, 59, None, false)?,
            minute: parse_cron_field(expanded[1], 0, 59, None, false)?,
            hour: parse_cron_field(expanded[2], 0, 23, None, false)?,
            day_of_month: parse_cron_field(expanded[3], 1, 31, None, false)?,
            month: parse_cron_field(expanded[4], 1, 12, Some(month), false)?,
            day_of_week: parse_cron_field(expanded[5], 0, 6, Some(weekday), true)?,
            year: parse_cron_field(expanded[6], 1, 9_999, None, false)?,
        },
    ))
}

fn parse_cron_field(
    source: &str,
    minimum: i32,
    maximum: i32,
    alias: Option<fn(&str) -> Option<i32>>,
    sunday_alias: bool,
) -> NativeResult<Vec<i32>> {
    let mut selected = BTreeSet::new();
    for segment in source.split(',') {
        let mut step_parts = segment.split('/');
        let base = step_parts.next().filter(|value| !value.is_empty());
        let step = step_parts
            .next()
            .map(|value| parse_integer(value, "Cron field step"))
            .transpose()?
            .unwrap_or(1);
        if base.is_none() || step_parts.next().is_some() || step < 1 {
            return Err(invalid(format!("Invalid cron field {source}.")));
        }
        let (start, end) = if base == Some("*") {
            (minimum, maximum)
        } else {
            let mut range = base.expect("checked").split('-');
            let start = field_text_unit(range.next().expect("checked"), alias)?;
            let end = range
                .next()
                .map(|value| field_text_unit(value, alias))
                .transpose()?
                .unwrap_or(start);
            if range.next().is_some() {
                return Err(invalid(format!("Invalid cron field {source}.")));
            }
            (start, end)
        };
        let allowed_maximum = if sunday_alias { maximum + 1 } else { maximum };
        if start < minimum || end > allowed_maximum || end < start {
            return Err(invalid(format!(
                "Cron field must be between {minimum} and {maximum}."
            )));
        }
        let mut current = start;
        while current <= end {
            selected.insert(if sunday_alias && current == 7 {
                0
            } else {
                current
            });
            current = current
                .checked_add(step as i32)
                .ok_or_else(|| invalid("Cron field step overflowed."))?;
        }
    }
    if selected.is_empty() {
        return Err(invalid("Cron field cannot be empty."));
    }
    Ok(selected.into_iter().collect())
}

fn field_unit(value: &JsonValue, alias: Option<fn(&str) -> Option<i32>>) -> NativeResult<i32> {
    match value {
        JsonValue::String(value) => field_text_unit(value, alias),
        _ => integer(value, "Calendar field").and_then(i32_value),
    }
}

fn field_text_unit(value: &str, alias: Option<fn(&str) -> Option<i32>>) -> NativeResult<i32> {
    alias
        .and_then(|resolve| resolve(value))
        .map(Ok)
        .unwrap_or_else(|| parse_integer(value, "Calendar field"))
}

fn parse_integer(value: &str, name: &str) -> NativeResult<i32> {
    value
        .parse::<i32>()
        .map_err(|_| invalid(format!("{name} must be an integer.")))
}

fn i32_value(value: i64) -> NativeResult<i32> {
    i32::try_from(value).map_err(|_| invalid("Calendar field is outside the supported range."))
}

fn month(value: &str) -> Option<i32> {
    match value.to_ascii_uppercase().as_str() {
        "JAN" | "JANUARY" => Some(1),
        "FEB" | "FEBRUARY" => Some(2),
        "MAR" | "MARCH" => Some(3),
        "APR" | "APRIL" => Some(4),
        "MAY" => Some(5),
        "JUN" | "JUNE" => Some(6),
        "JUL" | "JULY" => Some(7),
        "AUG" | "AUGUST" => Some(8),
        "SEP" | "SEPTEMBER" => Some(9),
        "OCT" | "OCTOBER" => Some(10),
        "NOV" | "NOVEMBER" => Some(11),
        "DEC" | "DECEMBER" => Some(12),
        _ => None,
    }
}

fn weekday(value: &str) -> Option<i32> {
    match value.to_ascii_uppercase().as_str() {
        "SUN" | "SUNDAY" => Some(0),
        "MON" | "MONDAY" => Some(1),
        "TUE" | "TUESDAY" => Some(2),
        "WED" | "WEDNESDAY" => Some(3),
        "THU" | "THURSDAY" => Some(4),
        "FRI" | "FRIDAY" => Some(5),
        "SAT" | "SATURDAY" => Some(6),
        _ => None,
    }
}

fn object<'a>(value: &'a JsonValue, name: &str) -> NativeResult<&'a Map<String, JsonValue>> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{name} must be an object.")))
}

fn required<'a>(value: &'a Map<String, JsonValue>, field: &str) -> NativeResult<&'a JsonValue> {
    value
        .get(field)
        .ok_or_else(|| invalid(format!("{field} is required.")))
}

fn string<'a>(value: &'a JsonValue, name: &str) -> NativeResult<&'a str> {
    value
        .as_str()
        .ok_or_else(|| invalid(format!("{name} must be a string.")))
}

fn integer(value: &JsonValue, name: &str) -> NativeResult<i64> {
    let value = value
        .as_f64()
        .filter(|value| {
            value.is_finite() && value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER
        })
        .ok_or_else(|| invalid(format!("{name} must be a safe integer.")))?;
    Ok(value as i64)
}

fn invalid(message: impl Into<String>) -> NativeError {
    NativeError::new("InvalidInput", message)
}
