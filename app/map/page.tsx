import { Suspense } from "react";
import MapView from "./MapView";

export default function MapPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading map…</p>}>
      <MapView />
    </Suspense>
  );
}
