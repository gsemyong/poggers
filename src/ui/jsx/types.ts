declare const jsxElement: unique symbol;

/** Opaque result of one platform-native JSX expression. It has no runtime form. */
export type JSXElement = Readonly<{ [jsxElement]: true }>;
