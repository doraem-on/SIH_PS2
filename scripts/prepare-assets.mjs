import { mkdirSync, copyFileSync } from "node:fs";
mkdirSync("public/maplibre", { recursive: true });
for (const name of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"])
  copyFileSync(
    `node_modules/maplibre-gl/dist/${name}`,
    `public/maplibre/${name}`,
  );
