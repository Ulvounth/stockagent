import { runDailyNews } from "../lib/daily-news";
import { isReportDue } from "../lib/schedule";

async function main() {
  if (process.argv.includes("--scheduled") && !isReportDue(new Date())) {
    console.log("Venter til kl. 09.00 norsk tid.");
    return;
  }
  const result = await runDailyNews();
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "completed") process.exitCode = 1;
}

main().catch(() => {
  console.error(
    "Nyhetsjobben feilet. Kontroller Supabase-migrasjonen og miljøvariablene. Ingen nøkler logges.",
  );
  process.exitCode = 1;
});
