import { describe, expect, it, beforeEach } from "vitest";
import {
  getNotificationQueue,
  memoryQueueDepthForTests,
  resetMemoryQueueForTests,
} from "../sqs.server";

describe("in-memory notification queue", () => {
  beforeEach(() => {
    delete process.env.AWS_SQS_QUEUE_URL;
    resetMemoryQueueForTests();
  });

  it("send/receive/delete job ids", async () => {
    const q = await getNotificationQueue();
    await q.send({ jobId: "job-a" });
    await q.send({ jobId: "job-b" });
    expect(memoryQueueDepthForTests()).toBe(2);

    const batch = await q.receive(10, 0);
    expect(batch.map((m) => m.body.jobId).sort()).toEqual(["job-a", "job-b"]);
    expect(memoryQueueDepthForTests()).toBe(0);

    await q.delete(batch[0].receiptHandle);
  });
});
