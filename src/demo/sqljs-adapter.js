// Da a una base de sql.js la misma forma que node:sqlite (exec, prepare().get/all/run),
// así service.js funciona igual en el navegador.

const toParams = (params) => params.map((p) => (p === undefined ? null : p));

export class SqlJsDatabase {
  constructor(raw) {
    this.raw = raw;
    this.cache = new Map();
  }

  exec(sql) {
    this.raw.exec(sql);
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  // export() de sql.js cierra y reabre la base: libera las sentencias y reinicia los PRAGMA.
  export() {
    this.cache.clear();
    const data = this.raw.export();
    this.raw.exec('PRAGMA foreign_keys = ON;');
    return data;
  }

  statement(sql) {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }
}

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  #run(params, collect) {
    const s = this.db.statement(this.sql);
    try {
      s.bind(toParams(params));
      return collect(s);
    } finally {
      s.reset();
    }
  }

  all(...params) {
    return this.#run(params, (s) => {
      const rows = [];
      while (s.step()) rows.push(s.getAsObject());
      return rows;
    });
  }

  get(...params) {
    return this.#run(params, (s) => (s.step() ? s.getAsObject() : undefined));
  }

  run(...params) {
    this.#run(params, (s) => s.step());
    const id = this.db.raw.exec('SELECT last_insert_rowid()')[0].values[0][0];
    return { changes: this.db.raw.getRowsModified(), lastInsertRowid: id };
  }
}
