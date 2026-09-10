# spike-harness — ticket 0118

Throwaway, alongside `lib/fog/spike-mask.ts` and `lib/fog/spike-cells.ts`. Deleted when
`0118` closes.

Proves the NUMERIC half of the spike without a browser anyone has to open: it compiles
`lib/fog/spike-mask.ts` on its own (that file has no imports, which is why this works),
drives it against a bare WebGL2 canvas with a stub projection prelude, and asserts
`judgeProbe` returns `max` — and, critically, that it returns `sum` and `overwrite` when
the blend equation is deliberately sabotaged.

What it CANNOT prove: the real MapLibre prelude compiling, and anything about a real GPU
driver. It runs on SwiftShader. The deployed `/dev/fog-spike` route answers those.

```
node tools/spike-harness/run.mjs            # MAX into R8, with a stub prelude
node tools/spike-harness/run-maplibre.mjs   # the same, inside a REAL maplibre-gl Map
```

Two runners, because they prove different things and the first cannot prove the second's half:

| | `run.mjs` | `run-maplibre.mjs` |
|---|---|---|
| Prelude | `STUB_PRELUDE` | MapLibre 6.6.0's own `shaderData.vertexShaderPrelude` |
| Bundler | none — `tsc` on one import-free file | esbuild, ~1.8 MB with maplibre-gl in it |
| Proves | `MAX` into `R8`, and that the probe reports `sum` and `overwrite` when sabotaged | that the real prelude compiles against these attributes, that `prerender`/`render` actually fire, and that removing and reinstalling the layer does not take the context down |

Both load over `file://` with everything inlined as a classic script. That is forced, not chosen: a
module script from a `null` origin is blocked by CORS and fails **silently** (the dumped DOM just
shows the placeholder), and served over `127.0.0.1` this snap-confined Chromium makes `--dump-dom`
hang until it is killed.
