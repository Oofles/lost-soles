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
node tools/spike-harness/run.mjs
```
