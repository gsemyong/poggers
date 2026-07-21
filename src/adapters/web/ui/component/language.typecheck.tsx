import type { Child } from "@/adapters/web/ui/component/runtime";

const _cleanupRef = (
  <button
    ref={(element) => {
      element.disabled = true;
      return () => {
        element.disabled = false;
      };
    }}
  />
);

const _dialogRef = (
  <dialog
    ref={(element) => {
      element.showModal();
      return () => element.close();
    }}
  />
);

function Button(props: { label: string; children?: Child; onPress?: () => void }) {
  return <button onClick={props.onPress}>{props.children ?? props.label}</button>;
}

function NoChildren(_props: { label: string }) {
  return <span />;
}

declare const label: string;
declare const enabled: boolean;

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
      className={enabled ? "enabled" : "disabled"}
      value={label}
      onInput={(event) => {
        event.currentTarget.value.toUpperCase();
      }}
    />
    <button
      type="submit"
      disabled={!enabled}
      style={{
        "--accent": "red",
        backgroundColor: "white",
      }}
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

const popoverOk = (
  <section>
    <button popoverTarget="menu" popoverTargetAction="toggle">
      Toggle
    </button>
    <div
      id="menu"
      popover="auto"
      onBeforeToggle={(event) => {
        const state: "closed" | "open" = event.newState;
        void state;
      }}
      onToggle={(event) => {
        event.currentTarget.hidePopover();
        const state: "closed" | "open" = event.oldState;
        void state;
      }}
    />
  </section>
);

const _dialogOk = (
  <dialog
    onCancel={(event) => event.preventDefault()}
    onClose={(event) => event.currentTarget.returnValue}
  />
);

// @ts-expect-error ARIA booleans accept only platform-valid boolean values.
const _invalidAriaExpanded = <button aria-expanded="yes" />;

// @ts-expect-error Roles are restricted to the platform role vocabulary.
const _invalidRole = <div role="drawer" />;

// @ts-expect-error Dialog lifecycle is mounted through the web toolkit, not a custom DOM prop.
const _removedDialogBinding = <dialog dialogOpen={enabled ? "modal" : false} />;

// @ts-expect-error dialog lifecycle modes are explicit.
const _invalidDialogMode = <dialog dialogOpen />;

// @ts-expect-error dialogOpen is a dialog lifecycle binding, not a global attribute.
const _invalidDialogOpen = <div dialogOpen />;

// @ts-expect-error popover target actions are narrowed to platform-valid values.
const _invalidPopoverTargetAction = <button popoverTargetAction="dismiss" />;

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

const reactiveAttributeOk = <div className={() => "ready"} aria-hidden={() => false} />;

// @ts-expect-error style property names are checked.
const _invalidStyleProp = <div style={{ definitelyNotCss: "red" }} />;

void componentOk;
void htmlOk;
void popoverOk;
void svgOk;
void customElementOk;
void reactiveAttributeOk;
