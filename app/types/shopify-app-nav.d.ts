import type { JSX as ReactJSX } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": ReactJSX.IntrinsicElements["s-link"];
    }
  }
}
