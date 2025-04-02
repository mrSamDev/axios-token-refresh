import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

const input = "src/index.js";
const external = Object.keys(pkg.peerDependencies || {});

export default [
  {
    input,
    output: [
      {
        file: pkg.main,
        format: "cjs",
        exports: "named",
        sourcemap: true,
      },
      {
        file: pkg.module,
        format: "esm",
        sourcemap: true,
      },
    ],
    external,
    plugins: [
      resolve(),
      commonjs(),
      babel({
        babelHelpers: "bundled",
        presets: [["@babel/preset-env", { targets: { node: "14" } }]],
        exclude: "node_modules/**",
      }),
    ],
  },

  {
    input,
    output: [
      {
        file: `dist/index.min.js`,
        format: "cjs",
        exports: "named",
        plugins: [terser()],
      },
      {
        file: `dist/index.esm.min.js`,
        format: "esm",
        plugins: [terser()],
      },
    ],
    external,
    plugins: [
      resolve(),
      commonjs(),
      babel({
        babelHelpers: "bundled",
        presets: [["@babel/preset-env", { targets: { node: "14" } }]],
        exclude: "node_modules/**",
      }),
    ],
  },

  {
    input: "src/index.js",
    output: {
      file: pkg.types,
      format: "es",
    },
    plugins: [dts()],
  },
];
