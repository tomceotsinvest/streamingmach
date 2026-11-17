// Run the daily loop by hand: npm run run-daily  (reads .env.local via --env-file if you pass it)
import { runDaily } from "../src/lib/pipeline";
runDaily(process.argv[2]).then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
