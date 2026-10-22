import { fetch as expoFetch } from "expo/fetch";
import { sqliteStaticRequestLog } from "@/db/staticRequestLog";
import { setStaticFetch, setStaticRequestLog } from "./gtfsFeed";

// Static GTFS zips come down through expo/fetch, whose `arrayBuffer()` hands
// the bytes over natively. React Native's fetch passes the body as base64 and
// decodes it in JS, which stalls the UI for a 2 MB zip. Imported for its side
// effect by the root layout.
setStaticFetch((url) => expoFetch(url));

// The limiter's grants go to SQLite, so they hold across relaunches and any
// second JS runtime in the process.
setStaticRequestLog(sqliteStaticRequestLog());
