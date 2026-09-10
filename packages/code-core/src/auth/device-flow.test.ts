import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { pollUntilResolved } from "./device-flow.js";
import type { DevicePollResponse, DeviceStartResponse, PaymodCodeClient } from "../api/paymod-code-client.js";

const start: DeviceStartResponse = {
  deviceCode: "pmdev_test",
  userCode: "TEST-CODE",
  verificationUri: "http://localhost:3000/dashboard/code/activate",
  expiresIn: 5,
  interval: 0,
};

function fakeClient(responses: DevicePollResponse[]): PaymodCodeClient {
  let call = 0;
  return {
    startDeviceAuth: () => Promise.reject(new Error("not used in this test")),
    pollDeviceAuth: () => Promise.resolve(responses[Math.min(call++, responses.length - 1)]!),
  } as unknown as PaymodCodeClient;
}

describe("pollUntilResolved", () => {
  test("returns the credential once approved", async () => {
    const client = fakeClient([{ status: "pending" }, { status: "approved", credential: "pm_live_abc" }]);
    assert.equal(await pollUntilResolved(client, start), "pm_live_abc");
  });

  test("throws when denied", async () => {
    const client = fakeClient([{ status: "denied" }]);
    await assert.rejects(() => pollUntilResolved(client, start), /denied/);
  });

  test("throws when the request expires", async () => {
    const client = fakeClient([{ status: "expired" }]);
    await assert.rejects(() => pollUntilResolved(client, start), /expired/);
  });

  test("throws on timeout if it never resolves within expiresIn", async () => {
    const client = fakeClient([{ status: "pending" }]);
    await assert.rejects(() => pollUntilResolved(client, { ...start, expiresIn: 0 }), /timed out/);
  });
});
