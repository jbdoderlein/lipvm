import { Store } from "./store";

export class Command {
  constructor(
    private store: Store,
    private migrationstatements: string[],
    private statements: string[]
  ) {}
  
  async executeAsync() {
    for (const s of this.migrationstatements){
        console.error(s)
        await this.store.updateSchema(s);
    }
    for (const s of this.statements){
        await this.store.updateData(s);
    }
  }  
}
