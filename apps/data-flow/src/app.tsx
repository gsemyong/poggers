import type { AppDef } from "@poggers/kit";
import { ordersFeature, type OrdersFeature } from "src/features/orders";
import { searchFeature, type SearchFeature } from "src/features/search";
import { dataFlowPreset } from "src/presets/data-flow";

export type App = {
  Actor: {
    readonly id: string;
  };
  Resources: {};
  Features: {
    search: SearchFeature;
    orders: OrdersFeature;
  };
  Components: {
    Shell: {
      Parts: {
        Root: "div";
        Header: "header";
        Brand: "strong";
        Description: "p";
        Main: "main";
      };
    };
  };
  Styles: {
    Presets: "system";
  };
};

export default {
  version: 1,
  app: { name: "Poggers data flow" },
  features: {
    search: searchFeature,
    orders: ordersFeature,
  },
  components: {
    Shell: {
      view({
        features: {
          orders: { OrdersPanel },
          search: { SearchPanel },
        },
        parts: { Root, Header, Brand, Description, Main },
      }) {
        return (
          <Root>
            <Header>
              <Brand>Data flow</Brand>
              <Description>
                One UI composed from local capability results and synchronized application state.
              </Description>
            </Header>
            <Main>
              <SearchPanel />
              <OrdersPanel />
            </Main>
          </Root>
        );
      },
    },
  },
  styles: {
    defaultPreset: "system",
    presets: { system: dataFlowPreset },
  },
  root: "Shell",
} satisfies AppDef<App>;
