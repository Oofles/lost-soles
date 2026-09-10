import type { Stack } from "aws-cdk-lib"
import { describe, expect, it } from "vitest"

/**
 * Ticket 0042, criteria 1-3 — the infrastructure, asserted against the CloudFormation
 * this backend actually synthesizes.
 *
 * `01-architecture.md` §2 is explicit that AWS validates nothing added through the CDK
 * escape hatch: *"you own the correctness and security of anything added this way."*
 * That sentence is what this file answers. Every number here is one a future edit could
 * change without breaking a single runtime test — a visibility timeout below the
 * function's own timeout, a `maxReceiveCount` of 10, a `batchSize` raised for throughput
 * — and each would fail only in production, on the day it mattered.
 *
 * The CDK context is what `ampx` supplies; it is set before the import because
 * `defineBackend` reads it while the module is evaluating. Both `Template.fromStack`
 * calls are at MODULE SCOPE and not inside a test: a full synth takes 6+ seconds in the
 * Amplify build container against vitest's 5-second per-test default, which is how
 * ticket 0041 failed a deploy with a timeout that reproduced nowhere locally.
 */
process.env.CDK_CONTEXT_JSON = JSON.stringify({
  "amplify-backend-namespace": "lost-soles-test",
  "amplify-backend-name": "test",
  "amplify-backend-type": "branch",
})

const { Template } = await import("aws-cdk-lib/assertions")
const { backend } = await import("./backend")

const ingest = Template.fromStack(backend.stack.node.findChild("IngestPipeline") as Stack)
const workerStack = Template.fromStack(backend.processActivity.stack)

/** The two queues, told apart by which one carries a redrive policy. */
const queues = () => Object.values(ingest.findResources("AWS::SQS::Queue"))
const mainQueue = () => {
  const found = queues().filter((q) => "RedrivePolicy" in (q.Properties ?? {}))
  expect(found, "exactly one queue should redrive to a DLQ").toHaveLength(1)
  return found[0] as { Properties: Record<string, unknown> }
}
const dlq = () => {
  const found = queues().filter((q) => !("RedrivePolicy" in (q.Properties ?? {})))
  expect(found, "exactly one queue should be a dead letter queue").toHaveLength(1)
  return found[0] as { Properties: Record<string, unknown> }
}

const workerFunction = () => {
  const functions = Object.values(workerStack.findResources("AWS::Lambda::Function")).filter(
    (f) => (f.Properties as { MemorySize?: number }).MemorySize === 2048,
  )
  expect(functions, "one 2048 MB function — the worker").toHaveLength(1)
  return functions[0] as { Properties: Record<string, unknown> }
}

/** Every statement on the worker's role, from its inline policies. */
function workerStatements(): Array<{
  Sid?: string
  Action?: string | string[]
  Condition?: Record<string, Record<string, string>>
}> {
  const policies = Object.values(workerStack.findResources("AWS::IAM::Policy"))
  const out: Array<{ Sid?: string; Action?: string | string[]; Condition?: never }> = []
  for (const policy of policies) {
    const document = (policy.Properties as { PolicyDocument?: { Statement?: unknown[] } })
      .PolicyDocument
    out.push(...((document?.Statement ?? []) as Array<{ Sid?: string; Condition?: never }>))
  }
  return out
}

/** Every IAM action the worker's role holds, from its inline policies, flattened. */
function workerActions(): string[] {
  const policies = Object.values(workerStack.findResources("AWS::IAM::Policy"))
  const actions: string[] = []
  for (const policy of policies) {
    const document = (policy.Properties as { PolicyDocument?: { Statement?: unknown[] } })
      .PolicyDocument
    for (const statement of document?.Statement ?? []) {
      const action = (statement as { Action?: string | string[] }).Action
      if (typeof action === "string") actions.push(action)
      else if (Array.isArray(action)) actions.push(...action)
    }
  }
  return actions
}

describe("the queue and the DLQ (criterion 1)", () => {
  /**
   * §4: "3 receive attempts, then the DLQ". SQS counts RECEIVES, so a `maxReceiveCount`
   * of 3 moves the message on the fourth delivery — the ticket's own wording.
   */
  it("redrives to the DLQ after three receives", () => {
    const redrive = mainQueue().Properties.RedrivePolicy as { maxReceiveCount?: number }
    expect(redrive.maxReceiveCount).toBe(3)
  })

  /**
   * Fourteen days is SQS's maximum. A message here is an activity that failed to import
   * on a map that cannot re-fog, so the retention is chosen to survive a holiday rather
   * than to be tidy.
   */
  it("keeps a dead letter for fourteen days", () => {
    expect(dlq().Properties.MessageRetentionPeriod).toBe(14 * 24 * 60 * 60)
  })

  /**
   * DERIVED, NOT CHOSEN: it must exceed the worker's 900-second timeout or SQS hands a
   * still-running message to a second invocation. Asserted as an INEQUALITY against the
   * function's own timeout rather than as the literal 960, so that changing one and
   * forgetting the other fails here instead of in production.
   */
  it("hides an in-flight message for longer than the worker can run", () => {
    const visibility = mainQueue().Properties.VisibilityTimeout as number
    const timeout = workerFunction().Properties.Timeout as number

    expect(visibility).toBeGreaterThan(timeout)
  })

  /** Standard, not FIFO — ordering is meaningless and exactly-once is not depended on. */
  it("is a standard queue", () => {
    expect(mainQueue().Properties.FifoQueue).toBeUndefined()
    expect(dlq().Properties.FifoQueue).toBeUndefined()
  })
})

describe("the worker's configuration (criterion 2)", () => {
  it("is 2048 MB and 900 seconds", () => {
    expect(workerFunction().Properties.MemorySize).toBe(2048)
    expect(workerFunction().Properties.Timeout).toBe(900)
  })

  /**
   * D-081, ASSERTED AS AN ABSENCE. A NAT gateway is $33/month against a ~$3 budget
   * (D-083), and a VPC-attached Lambda that also needs the internet forces one. Nothing
   * in `resource.ts` asks for a VPC; this is what makes that stay true.
   */
  it("is not attached to a VPC", () => {
    expect(workerFunction().Properties.VpcConfig).toBeUndefined()
  })

  /**
   * `batchSize: 1` — one poisoned message must not fail a batch of good ones. Without
   * partial-batch reporting a thrown handler fails its whole batch, so a batch of ten
   * would DLQ nine healthy activities alongside the one that was broken.
   */
  it("consumes one message per invocation", () => {
    workerStack.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
    })
  })

  /** The three generated values the handler reads by name and cannot know otherwise. */
  it("is handed the table, bucket and queue url it reads from the environment", () => {
    const environment = (
      workerFunction().Properties.Environment as { Variables?: Record<string, unknown> }
    ).Variables
    expect(Object.keys(environment ?? {})).toEqual(
      expect.arrayContaining([
        "ACTIVITY_TABLE",
        "RAW_ARCHIVE_BUCKET",
        "ACTIVITY_INGEST_QUEUE_URL",
        "USER_DATA_BUCKET",
      ]),
    )
  })
})

describe("the worker's IAM role (criterion 3)", () => {
  /**
   * I-7, AS AN ABSENCE — the form the invariant table asks for: *"no Lambda role holds
   * `dynamodb:DeleteItem` on T6 except the deletion role."*
   *
   * T6 (`ExploredCell`) does not exist until capability 07, so there is no grant to
   * inspect and the honest assertion is over the WHOLE role: this function holds no
   * `DeleteItem` on any table at all. That is strictly stronger than the invariant and
   * it is the version that can be written today — and it is written today deliberately,
   * because the moment T6 arrives is the moment somebody reaches for
   * `grantReadWriteData` out of habit, which includes `DeleteItem`. This test is what
   * turns that into a failing build instead of a permanent hole in a map that cannot
   * re-fog (D-020).
   */
  it("holds no dynamodb:DeleteItem, anywhere", () => {
    expect(workerActions()).not.toContain("dynamodb:DeleteItem")
    expect(workerActions().filter((a) => a.startsWith("dynamodb:Delete"))).toEqual([])
  })

  /**
   * I-3's other half, same shape. The archive is the one artifact no rebuild can
   * reproduce (D-101); the bucket policy denies deletion under `raw/*` to everything but
   * the break-glass role, and this asserts the worker never even asks.
   *
   * `0051` ADDED ONE DELETE, and the assertion moved rather than weakened: the worker may
   * delete under `users/*​/deltas/*` and nowhere else. That prefix holds objects that are
   * re-derivable from `raw/` plus T6 (§1.1), the bucket is versioned, and
   * `s3:DeleteObjectVersion` is denied bucket-wide — so even this grant writes a delete
   * marker rather than destroying bytes. `explored-cells-table.test.ts` asserts the scoping;
   * this asserts the shape of the exception, which is that there is exactly one.
   */
  it("can delete ONLY expired deltas, and never a version", () => {
    const deletes = workerActions().filter((a) => a.startsWith("s3:Delete"))
    expect([...new Set(deletes)]).toEqual(["s3:DeleteObject"])
    expect(deletes).not.toContain("s3:DeleteObjectVersion")
  })

  /**
   * Exactly two S3 actions, on one prefix. Asserted as an EXACT SET rather than as two
   * `toContain`s, because the failure worth catching is a third action appearing — which
   * is what `bucket.grantRead()` would do (`s3:List*` and `s3:GetBucket*` on the whole
   * bucket, since bucket-level access cannot be scoped to a prefix).
   */
  /**
   * `0049` added a second S3 statement — `users/*`, the explored delivery layer — so the
   * action list now carries each verb twice, once per prefix. The claim under test is
   * unchanged and is the one that matters: **only these two verbs**, on either prefix.
   * `explored-cells-table.test.ts` asserts which prefix each statement is scoped to.
   */
  it("can put and read objects, and nothing else in the bucket", () => {
    const s3 = workerActions().filter((a) => a.startsWith("s3:"))
    expect([...new Set(s3)].sort()).toEqual([
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:PutObject",
    ])
    // Four statements: raw/, users/, the delta GC, and 0192's raw/ listing. Never one widened
    // statement — the prefixes have different rules and a reviewer must see them separately.
    expect(s3).toHaveLength(6)
    // `bucket.grantRead()` would add `s3:GetBucket*` on the WHOLE bucket. Still never that.
    expect(s3.filter((a) => a.startsWith("s3:GetBucket"))).toEqual([])
  })

  /**
   * `0192` ADDED THE ONE `s3:List*` THIS ROLE HAS, AND THE ASSERTION MOVED RATHER THAN WEAKENED.
   *
   * The invariant was never "no listing" for its own sake — it is *"the worker cannot enumerate
   * other users' derived data"*, and until now that was implemented as no listing at all. Replay
   * needs to find one activity's archived object, whose key carries a content digest only the bytes
   * produce, so it must list `raw/<uid>/<source>/<externalId>/`.
   *
   * `s3:ListBucket` is a BUCKET-level action, so it cannot be scoped by resource ARN — which is
   * exactly what the older comment meant by "bucket-level access cannot be scoped to a prefix". It
   * CAN be scoped by condition, and this asserts that it is. Without the condition the worker could
   * enumerate every explored blob under `users/`, and the exact-set test above would still pass.
   */
  it("can list ONLY under raw/, by condition — the one List it holds", () => {
    const listing = workerStatements().filter((statement) => {
      const action = statement.Action
      const actions = typeof action === "string" ? [action] : (action ?? [])
      return actions.includes("s3:ListBucket")
    })
    expect(listing).toHaveLength(1)
    expect(listing[0]!.Condition).toEqual({ StringLike: { "s3:prefix": "raw/*" } })
  })

  /** The receipt, the credentials and the Activity row. */
  it("can read and write the three tables the pipeline touches", () => {
    const actions = workerActions()
    for (const action of ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem"]) {
      expect(actions).toContain(action)
    }
  })

  /**
   * The 429 path calls `ChangeMessageVisibility` on its own receipt handle. It comes
   * from `SqsEventSource`'s consume grant rather than from a hand-written statement,
   * which is exactly why it is worth asserting: it would disappear silently if the event
   * source were ever wired a different way.
   */
  it("can extend a message's visibility, which is how a rate limit is honoured", () => {
    expect(workerActions()).toContain("sqs:ChangeMessageVisibility")
  })
})

describe("the inline token refresh (§4 step 7)", () => {
  /**
   * The grant this file caught on its first run and the reason it exists.
   *
   * A refresh is a token EXCHANGE — it posts the client id and secret to the provider —
   * so `lib/sources/oauth-credentials.ts` reads both from SSM. Without the grant the
   * ordinary path works perfectly until the first token reaches its skew window, and
   * then every activity fails on an `AccessDeniedException` from SSM, an hour after the
   * deploy that caused it. Nothing else in the build would have said so.
   */
  it("can read the two OAuth client parameters, and only those two", () => {
    const statements = Object.values(workerStack.findResources("AWS::IAM::Policy")).flatMap(
      (policy) =>
        ((policy.Properties as { PolicyDocument?: { Statement?: unknown[] } }).PolicyDocument
          ?.Statement ?? []) as Array<{ Action?: string | string[]; Resource?: unknown }>,
    )

    const ssm = statements.filter((statement) => {
      const action = statement.Action
      const actions = typeof action === "string" ? [action] : (action ?? [])
      return actions.some((a) => a === "ssm:GetParameter")
    })

    expect(ssm, "one statement granting ssm:GetParameter").toHaveLength(1)
    const resources = ssm[0].Resource as unknown[]
    expect(resources).toHaveLength(2)
    /**
     * SERIALIZED, because `region` and `account` are CloudFormation tokens: each ARN
     * synthesizes to an `Fn::Join` rather than a string, and the literal half — the
     * parameter path — is what this assertion is about.
     *
     * NOT A PATH WILDCARD. The same prefix holds `GITHUB_TICKETS_PAT`, which acts as the
     * operator on this repository — a convenience grant here would let the ingest worker
     * push commits.
     */
    for (const resource of resources) {
      const rendered = JSON.stringify(resource)
      expect(rendered).toContain("parameter/amplify/shared/")
      expect(rendered).not.toContain("*")
    }
  })
})

describe("the customer-managed key on T7", () => {
  /**
   * The gap a live smoke test found and this build did not.
   *
   * `grantReadWriteData` grants the encryption key alongside the table; `Table.grant()`
   * does not. Narrowing the grants to keep `dynamodb:DeleteItem` off this role (I-7)
   * therefore removed the `kms:Decrypt` the credentials table needs, and nothing failed
   * — the assertions above check the actions that must be absent and the ones the
   * pipeline calls, and a missing KMS action is neither.
   *
   * A CMK's default policy delegates to IAM rather than granting anything itself, so the
   * table permission is necessary and not sufficient: without this the first activity
   * fails with an `AccessDeniedException` from KMS naming a key rather than a table.
   */
  it("grants the worker decrypt AND encrypt on the credentials key", () => {
    const actions = workerActions()
    expect(actions).toContain("kms:Decrypt")
    /** The encrypt half is what writes a rotated refresh token back. */
    expect(actions).toContain("kms:GenerateDataKey*")
  })
})

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * TICKET 0044, CRITERION 1 — THE ONE ALARM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `01-architecture.md` §4: *"A CloudWatch alarm on `ApproximateNumberOfMessagesVisible >
 * 0` on the DLQ is the only alarm this app needs."* Everything below is that sentence,
 * asserted — and the last test in the block is the word "only", which is the half a
 * future edit is most likely to break without meaning to.
 */
describe("the DLQ alarm", () => {
  const alarms = () => Object.values(ingest.findResources("AWS::CloudWatch::Alarm"))
  const alarm = () => {
    expect(alarms(), "exactly one alarm — §4 says one is all this app needs").toHaveLength(1)
    return alarms()[0] as { Properties: Record<string, unknown> }
  }

  it("watches the queue depth of the DLQ", () => {
    expect(alarm().Properties.MetricName).toBe("ApproximateNumberOfMessagesVisible")
    expect(alarm().Properties.Namespace).toBe("AWS/SQS")
  })

  /** `> 0`, on ONE datapoint. Any message at all is an activity that is not on the map. */
  it("fires on a single message", () => {
    expect(alarm().Properties.Threshold).toBe(0)
    expect(alarm().Properties.ComparisonOperator).toBe("GreaterThanThreshold")
    expect(alarm().Properties.EvaluationPeriods).toBe(1)
    expect(alarm().Properties.DatapointsToAlarm).toBe(1)
  })

  /**
   * `Maximum`, NOT `Average`. A DLQ holding one message averages down toward zero over a
   * long enough period and can fail to breach a threshold of zero; the maximum of a
   * queue depth is the only statistic that means "something was in here".
   */
  it("takes the maximum depth over a minute", () => {
    expect(alarm().Properties.Statistic).toBe("Maximum")
    expect(alarm().Properties.Period).toBe(60)
  })

  /**
   * THE SETTING THAT DECIDES WHETHER THE ALARM IS USABLE AT ALL. SQS publishes queue
   * metrics only while a queue is polled, so a DLQ empty for a week emits nothing —
   * which under any other treatment either pins the alarm in INSUFFICIENT_DATA or emails
   * the operator about a queue that is fine. Both end with the sender filtered, which is
   * the failure `09-roadmap.md` §8.6 names.
   */
  it("treats missing data as not breaching", () => {
    expect(alarm().Properties.TreatMissingData).toBe("notBreaching")
  })

  /**
   * THE NAME IS THE SUBJECT LINE. SNS renders an alarm as `ALARM: "<name>" in <region>`,
   * so this string is the whole of what the operator sees on a phone before deciding
   * whether to open it. A generated name would identify a CloudFormation stack.
   */
  it("is named so the email subject alone identifies the app", () => {
    expect(String(alarm().Properties.AlarmName)).toContain("Lost Soles")
  })

  it("notifies a topic", () => {
    expect((alarm().Properties.AlarmActions as unknown[]) ?? []).toHaveLength(1)
  })

  /**
   * AN UNCONFIRMED SUBSCRIPTION IS A SILENT ALARM. SNS delivers nothing until the
   * confirmation link is clicked, which is why the close records confirming it as an
   * operator step rather than assuming the deploy finished the job.
   */
  it("subscribes the operator by email", () => {
    const subscriptions = Object.values(ingest.findResources("AWS::SNS::Subscription"))
    expect(subscriptions).toHaveLength(1)
    expect((subscriptions[0].Properties as { Protocol?: string }).Protocol).toBe("email")
  })

  /**
   * THE WORD "ONLY", ASSERTED. §4 earns its single alarm by refusing every other one, and
   * `09-roadmap.md` §8.6 is the reason: at three to five runs a week an alarm on Lambda
   * errors or duration fires on cold starts and blips until the operator filters the
   * sender — at which point the DLQ alarm stops being read too. A second alarm here means
   * deleting a sentence from §4 first.
   */
  it("is the only alarm in the ingest stack", () => {
    expect(alarms()).toHaveLength(1)
    expect(Object.values(workerStack.findResources("AWS::CloudWatch::Alarm"))).toHaveLength(0)
  })
})

/**
 * THE HANDLER RESTATES `maxReceiveCount` and cannot import it — the queue is CDK and the
 * handler is a bundled Lambda. `MAX_RECEIVE_COUNT` is what decides whether a failure is
 * terminal (ticket 0044), so a drift between the two would silently move the point at
 * which a failure gets recorded: raise the queue to 5 and the handler marks FAILED two
 * deliveries early, reporting a failure that is still being retried.
 *
 * Asserted against the SOURCE TEXT rather than by importing the handler, because
 * importing it constructs AWS clients and reads environment variables this synth test
 * has neither of.
 */
describe("the handler's retry budget matches the queue's", () => {
  it("states the same maxReceiveCount the redrive policy does", async () => {
    const { readFileSync } = await import("node:fs")
    const source = readFileSync(
      new URL("./functions/process-activity/handler.ts", import.meta.url),
      "utf8",
    )
    const declared = /const MAX_RECEIVE_COUNT = (\d+)/.exec(source)?.[1]
    expect(declared, "handler.ts should declare MAX_RECEIVE_COUNT").toBeDefined()

    const redrive = mainQueue().Properties.RedrivePolicy as { maxReceiveCount?: number }
    expect(Number(declared)).toBe(redrive.maxReceiveCount)
  })
})
