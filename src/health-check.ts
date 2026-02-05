#!/usr/bin/env node
import { execSync } from "child_process";
import fs from "fs";
import chalk from "chalk";

interface HealthCheck {
  name: string;
  check: () => Promise<boolean>;
  message: string;
  error?: string;
}

const checks: HealthCheck[] = [
  {
    name: "Node.js Version",
    message: "Checking Node.js version (>= 22.0.0)...",
    check: async () => {
      const version = process.version;
      const major = parseInt(version.slice(1).split(".")[0]);
      return major >= 22;
    },
    error: "Node.js 22 or higher is required. Please upgrade Node.js.",
  },
  {
    name: "Docker",
    message: "Checking Docker availability...",
    check: async () => {
      try {
        execSync("docker --version", { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    },
    error: "Docker is not installed or not running. Install Docker to use the proof server.",
  },
  {
    name: "Environment File",
    message: "Checking .env configuration...",
    check: async () => {
      return fs.existsSync(".env");
    },
    error: ".env file not found. Run 'npm run setup' first.",
  },
  {
    name: "Wallet Seed",
    message: "Checking wallet configuration...",
    check: async () => {
      if (!fs.existsSync(".env")) return false;
      const envContent = fs.readFileSync(".env", "utf-8");
      return envContent.includes("WALLET_SEED=");
    },
    error: "WALLET_SEED not found in .env. Run 'npm run setup' to generate a wallet.",
  },
  {
    name: "Dependencies",
    message: "Checking node_modules...",
    check: async () => {
      return fs.existsSync("node_modules");
    },
    error: "Dependencies not installed. Run 'npm install' first.",
  },
  {
    name: "Contract Compilation",
    message: "Checking compiled contracts...",
    check: async () => {
      return fs.existsSync("dist") || fs.existsSync("build");
    },
    error: "Project not built. Run 'npm run compile' and 'npm run build'.",
  },
];

async function runHealthCheck() {
  console.log(chalk.blue.bold("\n🏥 Midnight App Health Check\n"));

  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    process.stdout.write(chalk.gray(`⏳ ${check.message} `));

    try {
      const result = await check.check();

      if (result) {
        console.log(chalk.green("✓ Passed"));
        passed++;
      } else {
        console.log(chalk.red("✗ Failed"));
        if (check.error) {
          console.log(chalk.yellow(`   ${check.error}`));
        }
        failed++;
      }
    } catch (error) {
      console.log(chalk.red("✗ Error"));
      console.log(chalk.yellow(`   ${check.error || "Unknown error"}`));
      failed++;
    }
  }

  console.log();
  console.log(chalk.bold("━".repeat(60)));
  console.log(
    chalk.bold(
      `Results: ${chalk.green(`${passed} passed`)} | ${chalk.red(`${failed} failed`)}`
    )
  );
  console.log(chalk.bold("━".repeat(60)));

  if (failed === 0) {
    console.log(chalk.green.bold("\n✓ All checks passed! Your environment is ready.\n"));
    process.exit(0);
  } else {
    console.log(
      chalk.yellow.bold(
        "\n⚠ Some checks failed. Please fix the issues above before continuing.\n"
      )
    );
    process.exit(1);
  }
}

runHealthCheck().catch((error) => {
  console.error(chalk.red("\n✗ Health check failed:"), error.message);
  process.exit(1);
});
