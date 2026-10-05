import assert from "node:assert/strict";
import test from "node:test";
import { extractEventsFromPayload } from "./route";

function payload(field: string, message: Record<string, unknown>) {
  return {
    entry: [
      {
        id: "entry-1",
        changes: [
          {
            field,
            value: {
              metadata: {
                phone_number_id: "phone-1",
                display_phone_number: "+55 11 90000-0000",
              },
              messages: [message],
            },
          },
        ],
      },
    ],
  };
}

test("coexistence echo is identified and never becomes a processable message", () => {
  const events = extractEventsFromPayload(
    payload("smb_message_echoes", {
      id: "echo-1",
      from: "5511900000000",
      type: "text",
      text: { body: "mensagem enviada no Business App" },
    }),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventKind, "message_echo");
});

test("history and app-state sync are identified but remain non-processable", () => {
  for (const field of ["history", "smb_app_state_sync", "account_update"] as const) {
    const events = extractEventsFromPayload({
      entry: [
        {
          id: "entry-1",
          changes: [
            {
              field,
              value: {
                metadata: { phone_number_id: "phone-1" },
                sync: { marker: "test" },
              },
            },
          ],
        },
      ],
    });

    assert.equal(events[0]?.eventKind, field);
  }
});

test("distinguishable group messages are identified separately", () => {
  const events = extractEventsFromPayload(
    payload("messages", {
      id: "group-1",
      from: "5511999999999",
      group_id: "group-identity",
      type: "text",
      text: { body: "grupo" },
    }),
  );

  assert.equal(events[0]?.eventKind, "group_message");
});
