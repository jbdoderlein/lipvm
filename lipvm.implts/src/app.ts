console.error("LIPVM rocks");


import { Command } from "./model";
import { Store } from "./store";



async function main(){
    const store = new Store();
    await store.init();
    await store.createTable();        
    const c = new Command(store, ["CREATE TABLE states AS SELECT 3 AS age, 'mandarin' AS name;"],["INSERT INTO states VALUES (4, 'foo')","INSERT INTO states VALUES (5, 'foo4')"]);

    await c.executeAsync();
    
    const data  =  await  store.executeCountQuery("select * from states;")
    data?.toArray().forEach(e=> {
        console.error('foo',e.toJSON());
    });

    await store.close();
}


main();
