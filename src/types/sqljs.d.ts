// sql.js ships the asm.js build (no .wasm file to serve) under a subpath without its own typings.
declare module 'sql.js/dist/sql-asm.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
