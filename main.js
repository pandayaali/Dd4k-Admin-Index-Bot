require('./bot');
require('./admin');

process.on("uncaughtException", (err) => {
  console.error("🧨 UNCAUGHT ERROR!");
  console.error(err);
});
