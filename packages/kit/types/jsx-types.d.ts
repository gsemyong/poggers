import type { Child } from "./ui";
type AttributeValue<T> = T | null | undefined;
type PrimitiveAttribute = string | number | boolean | null | undefined;
type Booleanish = boolean | "true" | "false";
type CrossOrigin = "anonymous" | "use-credentials" | "";
type Ref<T extends Element> = (element: T) => void;
type PopoverValue = "auto" | "hint" | "manual" | boolean;
type PopoverTargetAction = "hide" | "show" | "toggle";
type PopoverToggleEvent = Event & {
  readonly newState: "closed" | "open";
  readonly oldState: "closed" | "open";
};
type DOMEvent<T extends EventTarget, E extends Event> = E & {
  readonly currentTarget: T;
};
type EventHandler<T extends EventTarget, E extends Event> = {
  bivarianceHack(event: DOMEvent<T, E>): void;
}["bivarianceHack"];
type EventHandlerProps<T extends Element> = {
  onAbort?: EventHandler<T, UIEvent>;
  onAnimationCancel?: EventHandler<T, AnimationEvent>;
  onAnimationEnd?: EventHandler<T, AnimationEvent>;
  onAnimationIteration?: EventHandler<T, AnimationEvent>;
  onAnimationStart?: EventHandler<T, AnimationEvent>;
  onAuxClick?: EventHandler<T, MouseEvent>;
  onBeforeInput?: EventHandler<T, InputEvent>;
  onBeforeToggle?: EventHandler<T, PopoverToggleEvent>;
  onBlur?: EventHandler<T, FocusEvent>;
  onCancel?: EventHandler<T, Event>;
  onCanPlay?: EventHandler<T, Event>;
  onCanPlayThrough?: EventHandler<T, Event>;
  onChange?: EventHandler<T, Event>;
  onClick?: EventHandler<T, MouseEvent>;
  onClose?: EventHandler<T, Event>;
  onCompositionEnd?: EventHandler<T, CompositionEvent>;
  onCompositionStart?: EventHandler<T, CompositionEvent>;
  onCompositionUpdate?: EventHandler<T, CompositionEvent>;
  onContextMenu?: EventHandler<T, MouseEvent>;
  onCopy?: EventHandler<T, ClipboardEvent>;
  onCut?: EventHandler<T, ClipboardEvent>;
  onDblClick?: EventHandler<T, MouseEvent>;
  onDoubleClick?: EventHandler<T, MouseEvent>;
  onDrag?: EventHandler<T, DragEvent>;
  onDragEnd?: EventHandler<T, DragEvent>;
  onDragEnter?: EventHandler<T, DragEvent>;
  onDragExit?: EventHandler<T, DragEvent>;
  onDragLeave?: EventHandler<T, DragEvent>;
  onDragOver?: EventHandler<T, DragEvent>;
  onDragStart?: EventHandler<T, DragEvent>;
  onDrop?: EventHandler<T, DragEvent>;
  onDurationChange?: EventHandler<T, Event>;
  onEmptied?: EventHandler<T, Event>;
  onEnded?: EventHandler<T, Event>;
  onError?: EventHandler<T, ErrorEvent>;
  onFocus?: EventHandler<T, FocusEvent>;
  onFocusIn?: EventHandler<T, FocusEvent>;
  onFocusOut?: EventHandler<T, FocusEvent>;
  onFormData?: EventHandler<T, FormDataEvent>;
  onGotPointerCapture?: EventHandler<T, PointerEvent>;
  onInput?: EventHandler<T, InputEvent>;
  onInvalid?: EventHandler<T, Event>;
  onKeyDown?: EventHandler<T, KeyboardEvent>;
  onKeyPress?: EventHandler<T, KeyboardEvent>;
  onKeyUp?: EventHandler<T, KeyboardEvent>;
  onLoad?: EventHandler<T, Event>;
  onLoadStart?: EventHandler<T, Event>;
  onLoadedData?: EventHandler<T, Event>;
  onLoadedMetadata?: EventHandler<T, Event>;
  onLostPointerCapture?: EventHandler<T, PointerEvent>;
  onMouseDown?: EventHandler<T, MouseEvent>;
  onMouseEnter?: EventHandler<T, MouseEvent>;
  onMouseLeave?: EventHandler<T, MouseEvent>;
  onMouseMove?: EventHandler<T, MouseEvent>;
  onMouseOut?: EventHandler<T, MouseEvent>;
  onMouseOver?: EventHandler<T, MouseEvent>;
  onMouseUp?: EventHandler<T, MouseEvent>;
  onPaste?: EventHandler<T, ClipboardEvent>;
  onPause?: EventHandler<T, Event>;
  onPlay?: EventHandler<T, Event>;
  onPlaying?: EventHandler<T, Event>;
  onPointerCancel?: EventHandler<T, PointerEvent>;
  onPointerDown?: EventHandler<T, PointerEvent>;
  onPointerEnter?: EventHandler<T, PointerEvent>;
  onPointerLeave?: EventHandler<T, PointerEvent>;
  onPointerMove?: EventHandler<T, PointerEvent>;
  onPointerOut?: EventHandler<T, PointerEvent>;
  onPointerOver?: EventHandler<T, PointerEvent>;
  onPointerUp?: EventHandler<T, PointerEvent>;
  onProgress?: EventHandler<T, ProgressEvent>;
  onRateChange?: EventHandler<T, Event>;
  onReset?: EventHandler<T, Event>;
  onResize?: EventHandler<T, UIEvent>;
  onScroll?: EventHandler<T, Event>;
  onScrollEnd?: EventHandler<T, Event>;
  onSecurityPolicyViolation?: EventHandler<T, SecurityPolicyViolationEvent>;
  onSeeked?: EventHandler<T, Event>;
  onSeeking?: EventHandler<T, Event>;
  onSelect?: EventHandler<T, Event>;
  onSlotChange?: EventHandler<T, Event>;
  onStalled?: EventHandler<T, Event>;
  onSubmit?: EventHandler<T, SubmitEvent>;
  onSuspend?: EventHandler<T, Event>;
  onTimeUpdate?: EventHandler<T, Event>;
  onToggle?: EventHandler<T, PopoverToggleEvent>;
  onTouchCancel?: EventHandler<T, TouchEvent>;
  onTouchEnd?: EventHandler<T, TouchEvent>;
  onTouchMove?: EventHandler<T, TouchEvent>;
  onTouchStart?: EventHandler<T, TouchEvent>;
  onTransitionCancel?: EventHandler<T, TransitionEvent>;
  onTransitionEnd?: EventHandler<T, TransitionEvent>;
  onTransitionRun?: EventHandler<T, TransitionEvent>;
  onTransitionStart?: EventHandler<T, TransitionEvent>;
  onVolumeChange?: EventHandler<T, Event>;
  onWaiting?: EventHandler<T, Event>;
  onWheel?: EventHandler<T, WheelEvent>;
};
type CSSPropertyValue = string | number | null | undefined;
export type CSSProperties = {
  accentColor?: CSSPropertyValue;
  alignItems?: CSSPropertyValue;
  background?: CSSPropertyValue;
  backgroundColor?: CSSPropertyValue;
  border?: CSSPropertyValue;
  borderColor?: CSSPropertyValue;
  borderRadius?: CSSPropertyValue;
  borderWidth?: CSSPropertyValue;
  color?: CSSPropertyValue;
  cursor?: CSSPropertyValue;
  display?: CSSPropertyValue;
  flex?: CSSPropertyValue;
  flexDirection?: CSSPropertyValue;
  font?: CSSPropertyValue;
  fontFamily?: CSSPropertyValue;
  fontSize?: CSSPropertyValue;
  fontWeight?: CSSPropertyValue;
  gap?: CSSPropertyValue;
  gridTemplateColumns?: CSSPropertyValue;
  height?: CSSPropertyValue;
  justifyContent?: CSSPropertyValue;
  lineHeight?: CSSPropertyValue;
  margin?: CSSPropertyValue;
  marginBlock?: CSSPropertyValue;
  marginInline?: CSSPropertyValue;
  maxHeight?: CSSPropertyValue;
  maxWidth?: CSSPropertyValue;
  minHeight?: CSSPropertyValue;
  minWidth?: CSSPropertyValue;
  opacity?: CSSPropertyValue;
  overflow?: CSSPropertyValue;
  padding?: CSSPropertyValue;
  paddingBlock?: CSSPropertyValue;
  paddingInline?: CSSPropertyValue;
  pointerEvents?: CSSPropertyValue;
  position?: CSSPropertyValue;
  textAlign?: CSSPropertyValue;
  textDecoration?: CSSPropertyValue;
  transform?: CSSPropertyValue;
  transition?: CSSPropertyValue;
  width?: CSSPropertyValue;
} & {
  [CustomProperty in `--${string}`]?: CSSPropertyValue;
};
type DataAttributes = {
  [Key in `data-${string}`]?: AttributeValue<PrimitiveAttribute>;
};
type AriaAttributes = {
  [Key in `aria-${string}`]?: AttributeValue<string | number | Booleanish>;
};
type GlobalAttributes<T extends Element> = EventHandlerProps<T> &
  DataAttributes &
  AriaAttributes & {
    accessKey?: AttributeValue<string>;
    autocapitalize?: AttributeValue<"off" | "none" | "on" | "sentences" | "words" | "characters">;
    autofocus?: AttributeValue<boolean>;
    autoFocus?: AttributeValue<boolean>;
    children?: Child;
    class?: AttributeValue<string | false>;
    className?: AttributeValue<string | false>;
    contentEditable?: AttributeValue<boolean | "inherit" | "plaintext-only">;
    dir?: AttributeValue<"auto" | "ltr" | "rtl">;
    draggable?: AttributeValue<boolean>;
    enterKeyHint?: AttributeValue<
      "enter" | "done" | "go" | "next" | "previous" | "search" | "send"
    >;
    exportparts?: AttributeValue<string>;
    for?: AttributeValue<string>;
    hidden?: AttributeValue<boolean | "hidden" | "until-found">;
    id?: AttributeValue<string>;
    inert?: AttributeValue<boolean>;
    inputMode?: AttributeValue<
      "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search"
    >;
    is?: AttributeValue<string>;
    itemid?: AttributeValue<string>;
    itemprop?: AttributeValue<string>;
    itemref?: AttributeValue<string>;
    itemscope?: AttributeValue<boolean>;
    itemtype?: AttributeValue<string>;
    lang?: AttributeValue<string>;
    part?: AttributeValue<string>;
    popover?: AttributeValue<PopoverValue>;
    popoverOpen?: AttributeValue<boolean>;
    ref?: Ref<T>;
    role?: AttributeValue<string>;
    slot?: AttributeValue<string>;
    spellcheck?: AttributeValue<boolean>;
    style?: AttributeValue<string | CSSProperties>;
    tabindex?: AttributeValue<number>;
    tabIndex?: AttributeValue<number>;
    title?: AttributeValue<string>;
    translate?: AttributeValue<"yes" | "no" | boolean>;
  };
type ButtonType = "button" | "submit" | "reset";
type FormMethod = "dialog" | "get" | "post";
type FormEncType = "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";
type InputType =
  | "button"
  | "checkbox"
  | "color"
  | "date"
  | "datetime-local"
  | "email"
  | "file"
  | "hidden"
  | "image"
  | "month"
  | "number"
  | "password"
  | "radio"
  | "range"
  | "reset"
  | "search"
  | "submit"
  | "tel"
  | "text"
  | "time"
  | "url"
  | "week";
type Loading = "eager" | "lazy";
type Target = "_blank" | "_parent" | "_self" | "_top" | (string & {});
type HTMLSpecificAttributes<Tag extends keyof HTMLElementTagNameMap> = Tag extends "a"
  ? {
      download?: AttributeValue<boolean | string>;
      href?: AttributeValue<string>;
      hreflang?: AttributeValue<string>;
      ping?: AttributeValue<string>;
      referrerpolicy?: AttributeValue<ReferrerPolicy>;
      rel?: AttributeValue<string>;
      target?: AttributeValue<Target>;
      type?: AttributeValue<string>;
    }
  : Tag extends "button"
    ? {
        disabled?: AttributeValue<boolean>;
        form?: AttributeValue<string>;
        formaction?: AttributeValue<string>;
        formenctype?: AttributeValue<FormEncType>;
        formmethod?: AttributeValue<FormMethod>;
        formnovalidate?: AttributeValue<boolean>;
        formtarget?: AttributeValue<Target>;
        name?: AttributeValue<string>;
        popovertarget?: AttributeValue<string>;
        popovertargetaction?: AttributeValue<PopoverTargetAction>;
        popoverTarget?: AttributeValue<string>;
        popoverTargetAction?: AttributeValue<PopoverTargetAction>;
        type?: AttributeValue<ButtonType>;
        value?: AttributeValue<string | number>;
      }
    : Tag extends "form"
      ? {
          acceptCharset?: AttributeValue<string>;
          action?: AttributeValue<string>;
          autocomplete?: AttributeValue<"off" | "on">;
          enctype?: AttributeValue<FormEncType>;
          method?: AttributeValue<FormMethod>;
          novalidate?: AttributeValue<boolean>;
          target?: AttributeValue<Target>;
        }
      : Tag extends "iframe"
        ? {
            allow?: AttributeValue<string>;
            allowfullscreen?: AttributeValue<boolean>;
            loading?: AttributeValue<Loading>;
            referrerpolicy?: AttributeValue<ReferrerPolicy>;
            src?: AttributeValue<string>;
            srcdoc?: AttributeValue<string>;
          }
        : Tag extends "img"
          ? {
              alt?: AttributeValue<string>;
              crossorigin?: AttributeValue<CrossOrigin>;
              decoding?: AttributeValue<"async" | "auto" | "sync">;
              fetchpriority?: AttributeValue<"auto" | "high" | "low">;
              height?: AttributeValue<number | string>;
              loading?: AttributeValue<Loading>;
              referrerpolicy?: AttributeValue<ReferrerPolicy>;
              sizes?: AttributeValue<string>;
              src?: AttributeValue<string>;
              srcset?: AttributeValue<string>;
              width?: AttributeValue<number | string>;
            }
          : Tag extends "input"
            ? {
                accept?: AttributeValue<string>;
                autocomplete?: AttributeValue<string>;
                capture?: AttributeValue<boolean | "environment" | "user">;
                checked?: AttributeValue<boolean>;
                disabled?: AttributeValue<boolean>;
                form?: AttributeValue<string>;
                formaction?: AttributeValue<string>;
                formenctype?: AttributeValue<FormEncType>;
                formmethod?: AttributeValue<FormMethod>;
                formnovalidate?: AttributeValue<boolean>;
                formtarget?: AttributeValue<Target>;
                list?: AttributeValue<string>;
                max?: AttributeValue<number | string>;
                maxlength?: AttributeValue<number>;
                min?: AttributeValue<number | string>;
                minlength?: AttributeValue<number>;
                multiple?: AttributeValue<boolean>;
                name?: AttributeValue<string>;
                pattern?: AttributeValue<string>;
                placeholder?: AttributeValue<string>;
                popovertarget?: AttributeValue<string>;
                popovertargetaction?: AttributeValue<PopoverTargetAction>;
                popoverTarget?: AttributeValue<string>;
                popoverTargetAction?: AttributeValue<PopoverTargetAction>;
                readonly?: AttributeValue<boolean>;
                required?: AttributeValue<boolean>;
                size?: AttributeValue<number>;
                step?: AttributeValue<number | "any" | (string & {})>;
                type?: AttributeValue<InputType>;
                value?: AttributeValue<string | number | readonly string[]>;
              }
            : Tag extends "label"
              ? {
                  for?: AttributeValue<string>;
                  htmlFor?: AttributeValue<string>;
                }
              : Tag extends "link"
                ? {
                    as?: AttributeValue<string>;
                    crossorigin?: AttributeValue<CrossOrigin>;
                    href?: AttributeValue<string>;
                    hreflang?: AttributeValue<string>;
                    media?: AttributeValue<string>;
                    referrerpolicy?: AttributeValue<ReferrerPolicy>;
                    rel?: AttributeValue<string>;
                    sizes?: AttributeValue<string>;
                    type?: AttributeValue<string>;
                  }
                : Tag extends "meta"
                  ? {
                      charset?: AttributeValue<string>;
                      content?: AttributeValue<string>;
                      "http-equiv"?: AttributeValue<string>;
                      name?: AttributeValue<string>;
                    }
                  : Tag extends "option"
                    ? {
                        disabled?: AttributeValue<boolean>;
                        label?: AttributeValue<string>;
                        selected?: AttributeValue<boolean>;
                        value?: AttributeValue<string | number>;
                      }
                    : Tag extends "script"
                      ? {
                          async?: AttributeValue<boolean>;
                          crossorigin?: AttributeValue<CrossOrigin>;
                          defer?: AttributeValue<boolean>;
                          integrity?: AttributeValue<string>;
                          nomodule?: AttributeValue<boolean>;
                          referrerpolicy?: AttributeValue<ReferrerPolicy>;
                          src?: AttributeValue<string>;
                          type?: AttributeValue<string>;
                        }
                      : Tag extends "select"
                        ? {
                            autocomplete?: AttributeValue<string>;
                            disabled?: AttributeValue<boolean>;
                            form?: AttributeValue<string>;
                            multiple?: AttributeValue<boolean>;
                            name?: AttributeValue<string>;
                            required?: AttributeValue<boolean>;
                            size?: AttributeValue<number>;
                            value?: AttributeValue<string | number | readonly string[]>;
                          }
                        : Tag extends "source"
                          ? {
                              height?: AttributeValue<number | string>;
                              media?: AttributeValue<string>;
                              sizes?: AttributeValue<string>;
                              src?: AttributeValue<string>;
                              srcset?: AttributeValue<string>;
                              type?: AttributeValue<string>;
                              width?: AttributeValue<number | string>;
                            }
                          : Tag extends "textarea"
                            ? {
                                autocomplete?: AttributeValue<string>;
                                cols?: AttributeValue<number>;
                                disabled?: AttributeValue<boolean>;
                                dirname?: AttributeValue<string>;
                                form?: AttributeValue<string>;
                                maxlength?: AttributeValue<number>;
                                minlength?: AttributeValue<number>;
                                name?: AttributeValue<string>;
                                placeholder?: AttributeValue<string>;
                                readonly?: AttributeValue<boolean>;
                                required?: AttributeValue<boolean>;
                                rows?: AttributeValue<number>;
                                value?: AttributeValue<string | number>;
                                wrap?: AttributeValue<"hard" | "off" | "soft">;
                              }
                            : Tag extends "track"
                              ? {
                                  default?: AttributeValue<boolean>;
                                  kind?: AttributeValue<
                                    | "captions"
                                    | "chapters"
                                    | "descriptions"
                                    | "metadata"
                                    | "subtitles"
                                  >;
                                  label?: AttributeValue<string>;
                                  src?: AttributeValue<string>;
                                  srclang?: AttributeValue<string>;
                                }
                              : Tag extends "video"
                                ? {
                                    autoplay?: AttributeValue<boolean>;
                                    controls?: AttributeValue<boolean>;
                                    crossorigin?: AttributeValue<CrossOrigin>;
                                    height?: AttributeValue<number | string>;
                                    loop?: AttributeValue<boolean>;
                                    muted?: AttributeValue<boolean>;
                                    playsinline?: AttributeValue<boolean>;
                                    poster?: AttributeValue<string>;
                                    preload?: AttributeValue<"auto" | "metadata" | "none">;
                                    src?: AttributeValue<string>;
                                    width?: AttributeValue<number | string>;
                                  }
                                : {};
export type HTMLAttributes<Tag extends keyof HTMLElementTagNameMap> = GlobalAttributes<
  HTMLElementTagNameMap[Tag]
> &
  HTMLSpecificAttributes<Tag>;
type SVGLength = number | string;
type SVGPresentationAttributes = {
  accentHeight?: AttributeValue<SVGLength>;
  alignmentBaseline?: AttributeValue<string>;
  baselineShift?: AttributeValue<SVGLength>;
  clip?: AttributeValue<string>;
  clipPath?: AttributeValue<string>;
  clipRule?: AttributeValue<"evenodd" | "nonzero" | "inherit">;
  color?: AttributeValue<string>;
  colorInterpolation?: AttributeValue<string>;
  colorInterpolationFilters?: AttributeValue<string>;
  colorRendering?: AttributeValue<string>;
  cursor?: AttributeValue<string>;
  d?: AttributeValue<string>;
  direction?: AttributeValue<"inherit" | "ltr" | "rtl">;
  display?: AttributeValue<string>;
  dominantBaseline?: AttributeValue<string>;
  fill?: AttributeValue<string>;
  fillOpacity?: AttributeValue<number | string>;
  fillRule?: AttributeValue<"evenodd" | "nonzero" | "inherit">;
  filter?: AttributeValue<string>;
  floodColor?: AttributeValue<string>;
  floodOpacity?: AttributeValue<number | string>;
  fontFamily?: AttributeValue<string>;
  fontSize?: AttributeValue<SVGLength>;
  fontSizeAdjust?: AttributeValue<number | string>;
  fontStretch?: AttributeValue<string>;
  fontStyle?: AttributeValue<string>;
  fontVariant?: AttributeValue<string>;
  fontWeight?: AttributeValue<string | number>;
  glyphOrientationVertical?: AttributeValue<string>;
  imageRendering?: AttributeValue<string>;
  letterSpacing?: AttributeValue<SVGLength>;
  lightingColor?: AttributeValue<string>;
  markerEnd?: AttributeValue<string>;
  markerMid?: AttributeValue<string>;
  markerStart?: AttributeValue<string>;
  mask?: AttributeValue<string>;
  opacity?: AttributeValue<number | string>;
  overflow?: AttributeValue<string>;
  paintOrder?: AttributeValue<string>;
  pointerEvents?: AttributeValue<string>;
  shapeRendering?: AttributeValue<string>;
  stopColor?: AttributeValue<string>;
  stopOpacity?: AttributeValue<number | string>;
  stroke?: AttributeValue<string>;
  strokeDasharray?: AttributeValue<string | number>;
  strokeDashoffset?: AttributeValue<string | number>;
  strokeLinecap?: AttributeValue<"butt" | "round" | "square" | "inherit">;
  strokeLinejoin?: AttributeValue<"arcs" | "bevel" | "miter" | "miter-clip" | "round" | "inherit">;
  strokeMiterlimit?: AttributeValue<number | string>;
  strokeOpacity?: AttributeValue<number | string>;
  strokeWidth?: AttributeValue<SVGLength>;
  textAnchor?: AttributeValue<"end" | "inherit" | "middle" | "start">;
  textDecoration?: AttributeValue<string>;
  textRendering?: AttributeValue<string>;
  transform?: AttributeValue<string>;
  vectorEffect?: AttributeValue<string>;
  visibility?: AttributeValue<string>;
  wordSpacing?: AttributeValue<SVGLength>;
  writingMode?: AttributeValue<string>;
};
type SVGCoreAttributes = {
  cx?: AttributeValue<SVGLength>;
  cy?: AttributeValue<SVGLength>;
  dx?: AttributeValue<SVGLength>;
  dy?: AttributeValue<SVGLength>;
  height?: AttributeValue<SVGLength>;
  href?: AttributeValue<string>;
  points?: AttributeValue<string>;
  preserveAspectRatio?: AttributeValue<string>;
  r?: AttributeValue<SVGLength>;
  rx?: AttributeValue<SVGLength>;
  ry?: AttributeValue<SVGLength>;
  viewBox?: AttributeValue<string>;
  width?: AttributeValue<SVGLength>;
  x?: AttributeValue<SVGLength>;
  x1?: AttributeValue<SVGLength>;
  x2?: AttributeValue<SVGLength>;
  xlinkHref?: AttributeValue<string>;
  y?: AttributeValue<SVGLength>;
  y1?: AttributeValue<SVGLength>;
  y2?: AttributeValue<SVGLength>;
};
export type SVGAttributes<T extends SVGElement> = GlobalAttributes<T> &
  SVGPresentationAttributes &
  SVGCoreAttributes;
export type CustomElementAttributes = GlobalAttributes<HTMLElement> & {
  [AttributeName: string]: unknown;
};
export type IntrinsicElements = {
  [Tag in keyof HTMLElementTagNameMap]: HTMLAttributes<Tag>;
} & {
  [Tag in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: SVGAttributes<
    SVGElementTagNameMap[Tag]
  >;
} & {
  [Tag in `${string}-${string}`]: CustomElementAttributes;
};
export {};
