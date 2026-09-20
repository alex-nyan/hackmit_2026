import type { Metadata } from "next";

import { BostonMapShell } from "@/features/boston-map";
// Route-scoped: the map shell keeps its own neutral chrome rather than
// inheriting the dashboard's palette from globals.css.
import "./map.css";

export const metadata: Metadata = {
  title: "Paw Patrol · Boston map",
  description: "3D building map and live tracking across Boston and Cambridge.",
  icons: {
    icon: "/favicon-map.svg",
    shortcut: "/favicon-map.svg",
  },
};

export default function MapPage() {
  return <BostonMapShell />;
}
