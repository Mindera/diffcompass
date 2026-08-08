#!/usr/bin/env bun

export {};

interface Options {
  command?: "context" | "next" | "respond" | "ack" | "renew" | "refresh";
  url?: string;
  tokenFile?: string;
  after: number;
  waitMs: number;
  eventId?: string;
  leaseId?: string;
  file?: string;
}

function parseOptions(args: string[]): Options {
  const command = args.shift();
  if (command && !["context", "next", "respond", "ack", "renew", "refresh"].includes(command)) {
    throw new Error(`Unknown bridge command: ${command}`);
  }
  const options: Options = { command: command as Options["command"], after: 0, waitMs: 50_000 };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--url" && value) options.url = value;
    else if (arg === "--token-file" && value) options.tokenFile = value;
    else if (arg === "--after" && value) options.after = Number(value);
    else if (arg === "--wait-ms" && value) options.waitMs = Number(value);
    else if (arg === "--event" && value) options.eventId = value;
    else if (arg === "--lease" && value) options.leaseId = value;
    else if (arg === "--file" && value) options.file = value;
    else throw new Error(`Unknown or incomplete option: ${arg}`);
    index += 1;
  }
  return options;
}

async function request(options: Options, path: string, init?: RequestInit): Promise<unknown> {
  if (!options.url || !options.tokenFile) throw new Error("Both --url and --token-file are required.");
  const token = (await Bun.file(options.tokenFile).text()).trim();
  if (!token) throw new Error("The attached-agent token file is empty.");
  const response = await fetch(new URL(path, options.url), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-review-tour-token": token,
      ...init?.headers,
    },
  });
  const value = await response.json();
  if (!response.ok) throw new Error((value as { error?: string }).error ?? `Bridge request failed with ${response.status}.`);
  return value;
}

const options = parseOptions(process.argv.slice(2));
if (!options.command) {
  console.log("Usage: code-review-tour-bridge context|next|respond|ack|renew|refresh --url URL --token-file PATH [options]");
  process.exit(0);
}

let result: unknown;
if (options.command === "context") {
  result = await request(options, "/api/bridge/context");
} else if (options.command === "next") {
  result = await request(options, `/api/bridge/events?after=${options.after}&waitMs=${options.waitMs}`);
} else if (options.command === "respond") {
  if (!options.eventId || !options.leaseId || !options.file) throw new Error("respond requires --event ID, --lease LEASE_ID, and --file PATH.");
  const message = await Bun.file(options.file).text();
  result = await request(options, "/api/bridge/respond", {
    method: "POST",
    body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId, message }),
  });
} else if (options.command === "ack") {
  if (!options.eventId || !options.leaseId) throw new Error("ack requires --event ID and --lease LEASE_ID.");
  result = await request(options, "/api/bridge/ack", {
    method: "POST",
    body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId }),
  });
} else if (options.command === "renew") {
  if (!options.eventId || !options.leaseId) throw new Error("renew requires --event ID and --lease LEASE_ID.");
  result = await request(options, "/api/bridge/renew", {
    method: "POST",
    body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId }),
  });
} else {
  if (!options.eventId || !options.leaseId) throw new Error("refresh requires --event ID and --lease LEASE_ID.");
  result = await request(options, "/api/bridge/refresh", {
    method: "POST",
    body: JSON.stringify({ eventId: options.eventId, leaseId: options.leaseId }),
  });
}
console.log(JSON.stringify(result, null, 2));
