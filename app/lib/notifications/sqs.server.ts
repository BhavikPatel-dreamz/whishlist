/**
 * Thin SQS publisher/consumer. When AWS env is missing, uses an in-memory queue
 * so local/dev and mock load tests still exercise the outbox → worker path.
 */

export type SqsJobMessage = { jobId: string };

type QueueBackend = {
  send(body: SqsJobMessage): Promise<string>;
  receive(max: number, waitSeconds: number): Promise<Array<{
    receiptHandle: string;
    body: SqsJobMessage;
  }>>;
  delete(receiptHandle: string): Promise<void>;
  /** Test helper */
  depth(): number;
};

const memoryQueue: Array<{ id: string; body: SqsJobMessage }> = [];

const memoryBackend: QueueBackend = {
  async send(body) {
    const id = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    memoryQueue.push({ id, body });
    return id;
  },
  async receive(max) {
    const batch = memoryQueue.splice(0, max);
    return batch.map((item) => ({
      receiptHandle: item.id,
      body: item.body,
    }));
  },
  async delete(_receiptHandle) {
    /* already removed on receive for memory backend */
  },
  depth() {
    return memoryQueue.length;
  },
};

/** True when Amazon SQS is configured. Otherwise Postgres is the durable queue. */
export function isExternalQueueConfigured(): boolean {
  return Boolean(
    process.env.AWS_SQS_QUEUE_URL &&
      (process.env.AWS_ACCESS_KEY_ID || process.env.AWS_REGION),
  );
}

function awsConfigured(): boolean {
  return isExternalQueueConfigured();
}

async function awsBackend(): Promise<QueueBackend> {
  const { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } =
    await import("@aws-sdk/client-sqs");

  const client = new SQSClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const queueUrl = process.env.AWS_SQS_QUEUE_URL!;

  return {
    async send(body) {
      const res = await client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(body),
        }),
      );
      return res.MessageId || "unknown";
    },
    async receive(max, waitSeconds) {
      const res = await client.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: Math.min(Math.max(max, 1), 10),
          WaitTimeSeconds: Math.min(Math.max(waitSeconds, 0), 20),
          VisibilityTimeout: Number(process.env.AWS_SQS_VISIBILITY_TIMEOUT || 60),
        }),
      );
      return (res.Messages || []).flatMap((msg) => {
        if (!msg.Body || !msg.ReceiptHandle) return [];
        try {
          const body = JSON.parse(msg.Body) as SqsJobMessage;
          if (!body.jobId) return [];
          return [{ receiptHandle: msg.ReceiptHandle, body }];
        } catch {
          return [];
        }
      });
    },
    async delete(receiptHandle) {
      await client.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );
    },
    depth() {
      return -1;
    },
  };
}

let cached: QueueBackend | null = null;

export async function getNotificationQueue(): Promise<QueueBackend> {
  if (cached) return cached;
  if (awsConfigured()) {
    cached = await awsBackend();
  } else {
    console.warn(
      "[sqs] AWS_SQS_QUEUE_URL not set — using in-memory queue (dev/test only)",
    );
    cached = memoryBackend;
  }
  return cached;
}

/** Reset memory backend between tests. */
export function resetMemoryQueueForTests(): void {
  memoryQueue.length = 0;
  cached = null;
}

export function memoryQueueDepthForTests(): number {
  return memoryBackend.depth();
}
