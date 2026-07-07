/** @jsxImportSource @poggers/kit */
import type { Child, Signal } from "../ui";

function Button(props: { label: string; children?: Child; onPress?: () => void }) {
  return <button onClick={props.onPress}>{props.children ?? props.label}</button>;
}

function NoChildren(_props: { label: string }) {
  return <span />;
}

declare const label: Signal<string>;
declare const enabled: Signal<boolean>;

const componentOk = (
  <Button label="Save" onPress={() => {}}>
    Save
  </Button>
);

// @ts-expect-error component requires label.
const _componentMissingRequiredProp = <Button />;

// @ts-expect-error component does not accept unknown props.
const _componentUnknownProp = <Button label="Save" unknownProp="nope" />;

// @ts-expect-error this component does not accept children.
const _componentUnexpectedChildren = <NoChildren label="Save">Nope</NoChildren>;

const htmlOk = (
  <form method="post" data-testid="form">
    <label htmlFor="email">Email</label>
    <input
      id="email"
      type="email"
      aria-label="Email"
      className={() => (enabled() ? "enabled" : "disabled")}
      value={label}
      onInput={(event) => {
        event.currentTarget.value.toUpperCase();
      }}
    />
    <button
      type="submit"
      disabled={() => !enabled()}
      style={() => ({
        "--accent": "red",
        backgroundColor: "white",
      })}
      onClick={(event) => {
        event.currentTarget.disabled = true;
        // @ts-expect-error buttons do not have href.
        String(event.currentTarget.href);
      }}
    >
      Submit
    </button>
  </form>
);

const svgOk = (
  <svg viewBox="0 0 10 10" aria-hidden="true">
    <path d="M0 0h10" strokeWidth={2} strokeLinecap="round" />
  </svg>
);

const customElementOk = <poggers-widget data-id="main" someProp={{ ok: true }} />;

// @ts-expect-error unknown built-in tag names are rejected.
const _unknownIntrinsic = <buton />;

// @ts-expect-error unknown props on built-in elements are rejected.
const _unknownHtmlProp = <div nope="bad" />;

// @ts-expect-error button type is narrowed to browser-valid values.
const _invalidButtonType = <button type="invalid" />;

// @ts-expect-error input type is narrowed to browser-valid values.
const _invalidInputType = <input type="mailbox" />;

// @ts-expect-error className must be renderable.
const _invalidClassName = <div className={{ no: true }} />;

// @ts-expect-error style property names are checked.
const _invalidStyleProp = <div style={{ definitelyNotCss: "red" }} />;

void componentOk;
void htmlOk;
void svgOk;
void customElementOk;
