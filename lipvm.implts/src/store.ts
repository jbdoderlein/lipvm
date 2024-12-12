import * as duckdb from "@duckdb/duckdb-wasm";
import * as arrow from 'apache-arrow';


const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

export class Store {

  db ?: duckdb.AsyncDuckDB;
  worker?: Worker;
  
  async init(): Promise<void> {
    // Select a bundle based on browser checks
    const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

    const worker_url = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker!}");`], {
        type: "text/javascript",
      })
    );

    // Instantiate the asynchronus version of DuckDB-wasm
     this.worker = new Worker(worker_url);
    const logger = new duckdb.ConsoleLogger();
    this.db = new duckdb.AsyncDuckDB(logger, this.worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(worker_url);
  }

  async createTable(){
    const con = await this.db?.connect();
    con?.query("CREATE TABLE ducks AS SELECT 3 AS age, 'mandarin' AS breed;")
    con?.close();
  }



  async updateSchema(st:string){
    const con = await this.db?.connect();
    console.error(con);
    await con?.query(st)
    await con?.close();   
  }

  async updateData(st:string){
    const con = await this.db?.connect();
    await con?.query(st)
    await con?.close();   
  }
  async executeCountQuery(st:string){
    const con = await this.db?.connect();
    const s = await con?.query<{ v: arrow.Int }>(st)
    await con?.close();   
    return s;
  }



  async close(){
    await this.db?.terminate();
    await this.worker?.terminate();
  }
}
