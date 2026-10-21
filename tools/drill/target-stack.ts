import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { App, CfnOutput, DefaultStackSynthesizer, RemovalPolicy, Stack } from "aws-cdk-lib"
import { AttributeType, BillingMode, ProjectionType, Table, type TableProps } from "aws-cdk-lib/aws-dynamodb"
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3"

/**
 * THE DRILL'S PARALLEL STACK. Ticket `0105`; `02-data-model.md` §8.3 step 0 ("rebuild into new,
 * empty tables — a parallel CDK stack").
 *
 *   npx tsx tools/drill/target-stack.ts <tag> <outDir>
 *
 * Synthesises one stack, `LostSolesRebuildDrill-<tag>`, and writes two files to `<outDir>`: the
 * CloudFormation template, and the `target.json` that `npm run drill -- --phase=rebuild` takes.
 * Deploy the template with `aws cloudformation deploy`; it carries no assets, so no CDK bootstrap
 * is needed. The six table roles mirror the live tables' keys and indexes, so the stack could
 * serve a cutover (D-418: `landmark` is the sixth). The bucket is the stack's own.
 *
 * Everything is DESTROY and named from the tag: the stack is torn down after the drill (`0105`),
 * and nothing in it outlives that. Empty the bucket first — CloudFormation will not delete a bucket
 * that holds objects, and the drill's own code may not delete anything (`check-drill-no-delete`).
 */

const [tag, outDir] = process.argv.slice(2)
if (!tag || !/^[a-z0-9-]+$/.test(tag) || !outDir) {
  console.error("usage: npx tsx tools/drill/target-stack.ts <tag: [a-z0-9-]+> <outDir>")
  process.exit(2)
}

const app = new App({ outdir: join(outDir, "cdk.out") })
const stack = new Stack(app, `LostSolesRebuildDrill-${tag}`, {
  env: { account: "286588821906", region: "us-east-1" },
  // No assets, so no bootstrap: the version rule would only check an SSM parameter nothing uses.
  synthesizer: new DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
})

const str = AttributeType.STRING
const tableName = (role: string) => `LostSolesDrill-${tag}-${role}`
const bucketName = `lost-soles-drill-${tag}-286588821906`
function table(role: string, props: Omit<TableProps, "tableName" | "billingMode" | "removalPolicy">): Table {
  return new Table(stack, role, {
    ...props,
    tableName: tableName(role),
    billingMode: BillingMode.PAY_PER_REQUEST,
    removalPolicy: RemovalPolicy.DESTROY,
  })
}

const activity = table("Activity", { partitionKey: { name: "id", type: str } })
activity.addGlobalSecondaryIndex({
  indexName: "byUserAndStart",
  partitionKey: { name: "userId", type: str },
  sortKey: { name: "startedAt", type: str },
})
activity.addGlobalSecondaryIndex({
  indexName: "byUserAndDedupe",
  partitionKey: { name: "userId", type: str },
  sortKey: { name: "dedupeKey", type: str },
  projectionType: ProjectionType.KEYS_ONLY,
})
activity.addGlobalSecondaryIndex({
  indexName: "byUserAndDay",
  partitionKey: { name: "userIdLocalDay", type: str },
  sortKey: { name: "startedAtLocal", type: str },
  projectionType: ProjectionType.INCLUDE,
  nonKeyAttributes: ["xpAwarded", "kind", "distanceM"],
})

const ledger = table("XpLedgerEntry", { partitionKey: { name: "id", type: str } })
ledger.addGlobalSecondaryIndex({
  indexName: "byUserAndSeq",
  partitionKey: { name: "userId", type: str },
  sortKey: { name: "seq", type: str },
})
ledger.addGlobalSecondaryIndex({
  indexName: "byActivity",
  partitionKey: { name: "activityId", type: str },
  sortKey: { name: "skillIdReason", type: str },
})
ledger.addGlobalSecondaryIndex({
  indexName: "bySkill",
  partitionKey: { name: "userIdSkillId", type: str },
  sortKey: { name: "awardedAt", type: str },
})

table("SkillState", { partitionKey: { name: "userId", type: str }, sortKey: { name: "skillId", type: str } })
table("Profile", { partitionKey: { name: "id", type: str } })
table("ExploredCell", { partitionKey: { name: "pk", type: str }, sortKey: { name: "sk", type: str } })
table("Landmark", { partitionKey: { name: "userId", type: str }, sortKey: { name: "skillLevel", type: str } })

new Bucket(stack, "Bucket", {
  bucketName,
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  removalPolicy: RemovalPolicy.DESTROY,
})
new CfnOutput(stack, "BucketName", { value: bucketName })

const assembly = app.synth()
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, "template.json"), JSON.stringify(assembly.getStackByName(stack.stackName).template, null, 2))
// The names are literals, not tokens, so the target file is plain JSON.
const target = {
  tables: {
    activity: tableName("Activity"),
    ledger: tableName("XpLedgerEntry"),
    skillState: tableName("SkillState"),
    profile: tableName("Profile"),
    exploredCell: tableName("ExploredCell"),
    landmark: tableName("Landmark"),
  },
  bucket: bucketName,
  prefix: "",
}
writeFileSync(join(outDir, "target.json"), JSON.stringify(target, null, 2) + "\n")
console.log(JSON.stringify({ stackName: stack.stackName, template: join(outDir, "template.json"), target }))
