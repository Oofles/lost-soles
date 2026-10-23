import { Aspects, CfnResource, Names, Stack, type IAspect } from "aws-cdk-lib"
import { LogRetention, RetentionDays } from "aws-cdk-lib/aws-logs"
import type { IConstruct } from "constructs"

/**
 * Ticket 0305 — every Lost Soles log group expires after 30 days, as `08-security-privacy.md`
 * §3.1 and §6.1 say, and the account-deletion runbook's step 7 ("let the logs age out") relies on.
 *
 * WHY A `LogRetention` CUSTOM RESOURCE, NOT AN EXPLICIT `LogGroup` AND NOT AMPLIFY'S
 * `logging.retention`. Every Lambda here already has its log group, `/aws/lambda/<function name>`,
 * created by Lambda itself on first invocation and owned by nobody:
 *
 * - An explicit `new LogGroup({ logGroupName: "/aws/lambda/<fn>" })` asks CloudFormation to
 *   CREATE a group that exists, and the deploy fails with `AlreadyExists` — the ticket's warning.
 * - `defineFunction({ logging: { retention } })` sidesteps that by creating a NEW group with a
 *   generated name and pointing the function's `LoggingConfig` at it. That orphans the existing
 *   groups with everything already logged in them (still never-expiring), silently detaches the
 *   webhook flood alarm's metric filter (`backend.ts`, which reads `/aws/lambda/<fn>` by name), and
 *   reaches only `defineFunction` functions — half the 14 groups belong to framework Lambdas
 *   (CDK's S3 auto-delete and bucket deployment, Amplify's table manager and branch linker).
 * - `LogRetention` calls `PutRetentionPolicy` on the group BY NAME, creating it first if it is
 *   missing and ignoring `ResourceAlreadyExistsException`. Nothing changes owner, no name changes,
 *   and a group that exists today simply gains its retention on the next deploy.
 *
 * WHY AN ASPECT. It visits every `AWS::Lambda::Function` in every stack of the backend, framework
 * Lambdas included, so a function added later inherits the retention without anyone remembering
 * to ask for it. `log-retention.test.ts` fails the synth if one does not.
 *
 * THE ONE EXCEPTION is the `LogRetention` provider Lambda itself (one per stack that has a
 * function). Its handler sets its OWN group to 1 day on create, by CDK design; giving it a 30-day
 * `LogRetention` too would race that. One day is stricter than the 30 the design asks for.
 *
 * Retention is never removed on delete (`LogRetention`'s default `RETAIN`), so tearing down a
 * sandbox never deletes or un-expires a group.
 */
export const LOG_RETENTION = RetentionDays.ONE_MONTH
export const LOG_RETENTION_DAYS = 30

/** The construct id CDK gives the singleton provider. Stable: it is a literal in aws-cdk-lib. */
export const LOG_RETENTION_PROVIDER_ID = "LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a"

/**
 * The Amplify Hosting app. Its SSR compute group, `/aws/amplify/<appId>`, is created by Amplify
 * Hosting rather than by this backend, so no Lambda resource points at it. The id is already a
 * literal in `backend.ts` (the shared SSM parameter paths); a second Amplify app would need it in
 * both places.
 */
export const AMPLIFY_APP_ID = "d14fhvl4rp79nn"
export const AMPLIFY_HOSTING_LOG_GROUP = `/aws/amplify/${AMPLIFY_APP_ID}`

const isLambdaFunction = (node: IConstruct): node is CfnResource =>
  CfnResource.isCfnResource(node) && node.cfnResourceType === "AWS::Lambda::Function"

class LambdaLogRetention implements IAspect {
  visit(node: IConstruct): void {
    if (!isLambdaFunction(node)) return
    if (node.node.path.includes(LOG_RETENTION_PROVIDER_ID)) return
    new LogRetention(Stack.of(node), `LogRetention${Names.nodeUniqueId(node.node)}`, {
      logGroupName: `/aws/lambda/${node.ref}`,
      retention: LOG_RETENTION,
    })
  }
}

/**
 * Apply the 30-day retention to every Lambda under `root` (the backend's root stack, whose nested
 * stacks are its descendants) and, on a branch deploy, to the Amplify Hosting app's group.
 * A sandbox does not touch the hosting group: it belongs to the deployed app, not to a sandbox.
 */
export function applyLogRetention(root: Stack): void {
  Aspects.of(root).add(new LambdaLogRetention())
  if (root.node.tryGetContext("amplify-backend-type") === "branch") {
    new LogRetention(root, "AmplifyHostingLogRetention", {
      logGroupName: AMPLIFY_HOSTING_LOG_GROUP,
      retention: LOG_RETENTION,
    })
  }
}
