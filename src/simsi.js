const app = require("./app");

const port = Number(process.env.PORT ?? 3001);

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
