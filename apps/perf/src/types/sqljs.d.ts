// sql.js builds under subpaths without their own typings.
declare module 'sql.js/dist/sql-asm.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
declare module 'sql.js/dist/sql-wasm.js' {
  import initSqlJs from 'sql.js';
  export default initSqlJs;
}
declare module '*.wasm' {
  const asset: number;
  export default asset;
}
