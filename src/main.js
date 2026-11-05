import { openDb, migrate } from './db.js';
import { createServer } from './server.js';

const db = openDb(process.env.DB_PATH ?? ':memory:');
migrate(db);
const port = Number(process.env.PORT ?? 3000);
createServer(db).listen(port, '127.0.0.1', () => console.log(`listening on http://127.0.0.1:${port}/signup.html`));
