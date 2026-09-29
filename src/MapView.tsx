import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
import { Maximize2, Layers, LocateFixed, Plus, Minus } from "lucide-react";
export default function MapView({
  data,
  onSelect,
  large = false,
  layers = [],
}: {
  data: any;
  onSelect: (f: any) => void;
  large?: boolean;
  layers?: any[];
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<maplibregl.Map | null>(null),
    latest = useRef(onSelect),
    current = useRef(data),
    currentLayers = useRef(layers);
  const [tiles, setTiles] = useState(true),
    [error, setError] = useState(false);
  latest.current = onSelect;
  current.current = data;
  currentLayers.current = layers;
  const overlay = () =>
    ({
      type: "FeatureCollection",
      features: currentLayers.current.flatMap((s) =>
        s.geojson.features.map((f: any) => ({
          ...f,
          properties: { ...f.properties, _source: s.name },
        })),
      ),
    }) as any;
  useEffect(() => {
    if (!container.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: container.current,
        center: [80, 23.8],
        zoom: 3.55,
        minZoom: 1.4,
        maxZoom: 16,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            base: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution:
                '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
            },
            countries: {
              type: "geojson",
              data: "/countries.geojson",
              attribution: "Natural Earth · Public domain",
            },
          },
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#e1eceb" },
            },
            {
              id: "land",
              type: "fill",
              source: "countries",
              paint: {
                "fill-color": "#f1f0e8",
                "fill-outline-color": "#c5d0c7",
              },
            },
            {
              id: "base",
              type: "raster",
              source: "base",
              paint: { "raster-opacity": 0.68, "raster-saturation": -0.85 },
            },
          ],
        },
      });
    } catch {
      setError(true);
      return;
    }
    map.current = m;
    m.on("load", () => {
      m.fitBounds(
        [
          [67, 6],
          [98, 37],
        ],
        { padding: { top: 55, bottom: 55, left: 25, right: 25 }, duration: 0 },
      );
      m.addSource("events", { type: "geojson", data: current.current });
      m.addSource("uploaded", { type: "geojson", data: overlay() });
      m.addLayer({
        id: "polygons",
        type: "fill",
        source: "uploaded",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#17826c",
          "fill-opacity": 0.2,
          "fill-outline-color": "#125843",
        },
      });
      m.addLayer({
        id: "halo",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 7, 9, 15],
          "circle-color": [
            "match",
            ["get", "size"],
            "large",
            "#cd5d42",
            "very_large",
            "#cd5d42",
            "catastrophic",
            "#a53e30",
            "medium",
            "#d29b40",
            "#488572",
          ],
          "circle-opacity": 0.12,
        },
      });
      m.addLayer({
        id: "points",
        type: "circle",
        source: "events",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.3, 9, 7],
          "circle-color": [
            "match",
            ["get", "size"],
            "large",
            "#cd5d42",
            "very_large",
            "#cd5d42",
            "catastrophic",
            "#a53e30",
            "medium",
            "#d29b40",
            "#488572",
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-opacity": 0.9,
        },
      });
      m.on("click", "points", (e) => {
        if (e.features?.[0]) latest.current(e.features[0]);
      });
      m.on("mouseenter", "points", () => {
        m.getCanvas().style.cursor = "pointer";
      });
      m.on("mouseleave", "points", () => {
        m.getCanvas().style.cursor = "";
      });
    });
    m.on("error", () => {
      /* Local country outlines remain available when a tile fails. */
    });
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const m = map.current;
    if (m?.getSource("events"))
      (m.getSource("events") as maplibregl.GeoJSONSource).setData(data);
  }, [data]);
  useEffect(() => {
    const m = map.current;
    if (m?.getSource("uploaded"))
      (m.getSource("uploaded") as maplibregl.GeoJSONSource).setData(overlay());
  }, [layers]);
  return (
    <div className={`map-shell ${large ? "large" : ""}`}>
      <div ref={container} className="map-canvas" />
      {error && (
        <div className="map-fallback">
          WebGL is unavailable. Explore the same verified records in the event
          list.
        </div>
      )}
      <div className="map-label">
        <span className="pulse" /> NASA LANDSLIDE CATALOG{" "}
        <span className="map-label-sub">Historical observations</span>
      </div>
      <div className="map-buttons">
        <button aria-label="Zoom in" onClick={() => map.current?.zoomIn()}>
          <Plus size={17} />
        </button>
        <button aria-label="Zoom out" onClick={() => map.current?.zoomOut()}>
          <Minus size={17} />
        </button>
        <button
          aria-label="Reset map to India"
          onClick={() =>
            map.current?.fitBounds(
              [
                [67, 6],
                [98, 37],
              ],
              { padding: { top: 55, bottom: 55, left: 25, right: 25 } },
            )
          }
        >
          <LocateFixed size={17} />
        </button>
        <button
          aria-label="Toggle basemap"
          className={!tiles ? "active" : ""}
          onClick={() => {
            map.current?.setLayoutProperty(
              "base",
              "visibility",
              tiles ? "none" : "visible",
            );
            setTiles(!tiles);
          }}
        >
          <Layers size={17} />
        </button>
        <button
          aria-label="Fit all displayed events"
          onClick={() => {
            const coords = data.features.map(
              (f: any) => f.geometry.coordinates,
            );
            if (coords.length) {
              const bounds = new maplibregl.LngLatBounds();
              coords.forEach((c: any) => bounds.extend(c));
              map.current?.fitBounds(bounds, { padding: 70, maxZoom: 8 });
            }
          }}
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <div className="map-legend">
        <span>
          <i className="dot terracotta" />
          Large
        </span>
        <span>
          <i className="dot amber" />
          Medium
        </span>
        <span>
          <i className="dot green" />
          Small / unknown
        </span>
        <b>Reported event size</b>
      </div>
      <div className="map-count">
        {data.features.length.toLocaleString()} observations
      </div>
    </div>
  );
}
