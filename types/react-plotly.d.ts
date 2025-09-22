// types/react-plotly.d.ts
declare module "react-plotly.js" {
  import type { ComponentType } from "react";
  // If you later add stricter props, replace `any` with an interface
  const Plot: ComponentType<any>;
  export default Plot;
}
