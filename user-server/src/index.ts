import express from 'express';
import config from './config';
import { configureRoutes } from './routes';

const app = express();
const port = config.PORT;

configureRoutes(app);

app.listen(port, () => {
  console.log(`User server listening at http://localhost:${port}`);
});
