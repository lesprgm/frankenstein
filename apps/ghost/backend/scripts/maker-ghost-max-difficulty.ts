import { makerReliableExtractMemory } from '@memorylayer/memory-extraction';
import { geminiMakerProvider } from '../src/services/gemini-maker-provider.js';
import { makerConfig } from '@memorylayer/memory-extraction/dist/maker-config.js';

/**
 * GHOST MAX DIFFICULTY TEST: "The Legacy Refactor & The Outage"
 * 
 * This simulates a realistic, high-stress developer session with Ghost.
 * 
 * Challenges:
 * 1. **Context Switching**: User jumps between a complex refactor and a sudden production outage.
 * 2. **Implicit Context**: User refers to "that file", "the old one", "it".
 * 3. **Reversed Decisions**: "Refactor this" -> "No wait" -> "Actually delete it".
 * 4. **Multi-step Instructions**: "Copy X to Y, then delete X".
 * 5. **Hidden Constraints**: "Don't merge yet", "Keep the comments".
 * 
 * MAKER Challenge:
 * - Track the state of the refactor (Move `smite` -> Delete `OldGod`).
 * - Separate the outage resolution from the refactor work.
 * - Capture the final status of the code (Ready to merge? No.).
 */
const GHOST_SESSION_LOG = `
[User]: Ghost, open OldGod.ts. I want to refactor the summon method.
[Ghost]: Opening OldGod.ts...
[User]: It's too messy. Let's split it into a helper class.
[Ghost]: I can create SummonHelper.ts. Shall I proceed?
[User]: No, wait. The Ritual interface relies on this being a single class. We can't split it.
[User]: Actually... is Ritual even used anymore? Search for usages of Ritual.
[Ghost]: Searching for "Ritual"... Found 0 usages in src/. Found 1 usage in tests/legacy.test.ts.
[User]: Ha! I knew it. Okay, change of plan.
[User]: We're not refactoring OldGod. We're deleting it.
[User]: But wait, NewGod.ts needs the 'smite' logic.
[User]: So here's the plan: Copy the smite method from OldGod to NewGod, but modernize the types.
[User]: THEN delete OldGod. And delete that legacy test too.
[Ghost]: Understood. I will copy smite to NewGod, update types, then delete OldGod and the test.
[User]: HOLD ON. PagerDuty just fired.
[User]: Check the prod logs for the payment-service.
[Ghost]: Tailng logs for payment-service...
[User]: I see it. NPE in the checkout flow. It's that null check we missed.
[User]: Open Checkout.ts.
[Ghost]: Opening Checkout.ts...
[User]: Yeah, line 45. Add a check for 'cart.items'.
[Ghost]: Applying fix to Checkout.ts...
[User]: Deploy that hotfix immediately.
[Ghost]: Deploying hotfix... Deployment successful.
[User]: Phew. Okay, crisis averted.
[User]: Back to the real work. Where were we?
[User]: Oh right, the god migration.
[User]: Did you copy the method yet?
[Ghost]: Not yet. I paused when the alert came in.
[User]: Okay, do it now. But keep the JSDoc comments, the new junior dev needs them.
[User]: And don't commit the deletion yet, I want to review the diff first.
`;

async function runGhostMaxTest(apiKey: string) {
    // Set API key for Ghost's LLMCoordinator
    process.env.GEMINI_API_KEY = apiKey;

    // Ensure we use the configured model
    if (!process.env.MAKER_MODEL && !process.env.GEMINI_MODEL) {
        process.env.MAKER_MODEL = 'gemini-flash-latest';
    }

    console.log('='.repeat(80));
    console.log('👻 GHOST MAX DIFFICULTY TEST - "The Legacy Refactor & The Outage"');
    console.log('='.repeat(80));
    console.log();
    console.log('Scenario Challenges:');
    console.log('  - Context Switching (Refactor -> Outage -> Refactor)');
    console.log('  - Reversed Decisions (Refactor -> Delete)');
    console.log('  - Multi-step Plan (Copy -> Modernize -> Delete)');
    console.log('  - Constraints (Keep JSDoc, Don\'t commit yet)');
    console.log();
    console.log('Configuration:');
    console.log(`  - Enabled: ${makerConfig.enabled}`);
    console.log(`  - Replicas: ${makerConfig.replicas}`);
    console.log(`  - Model: ${process.env.MAKER_MODEL || 'gemini-flash-latest'}`);
    console.log();
    console.log('Running MAKER Extraction...');
    console.log();

    const startTime = Date.now();

    try {
        const result = await makerReliableExtractMemory(GHOST_SESSION_LOG, geminiMakerProvider);
        const duration = Date.now() - startTime;

        console.log('='.repeat(80));
        console.log('GHOST MAKER RESULT');
        console.log('='.repeat(80));
        console.log();

        if (result) {
            console.log('✅ Extraction Successful!');
            console.log();
            console.log('📝 Summary:');
            console.log(result.summary);
            console.log();
            console.log(`🎯 Decisions (${result.decisions.length}):`);
            result.decisions.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
            console.log();
            console.log(`📋 Action Items (${result.todos.length}):`);
            result.todos.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
            console.log();
            console.log(`⏱️  Duration: ${duration}ms`);
            console.log();

            // Verification Logic
            const summaryLower = result.summary.toLowerCase();
            const decisionsLower = result.decisions.map(d => d.toLowerCase()).join(' ');
            const todosLower = result.todos.map(t => t.toLowerCase()).join(' ');

            const gotMigration = summaryLower.includes('oldgod') && summaryLower.includes('newgod');
            const gotHotfix = summaryLower.includes('payment') || summaryLower.includes('checkout') || summaryLower.includes('hotfix');
            const gotConstraint = todosLower.includes('review') || todosLower.includes('diff') || decisionsLower.includes('review');
            const gotJSDoc = todosLower.includes('jsdoc') || decisionsLower.includes('jsdoc');
            const ignoredSplit = !summaryLower.includes('summonhelper');

            console.log('🎓 MAKER Analysis:');
            console.log(`  - Tracked "God Migration" Plan: ${gotMigration ? '✅ YES' : '❌ NO'}`);
            console.log(`  - Tracked "Payment Hotfix": ${gotHotfix ? '✅ YES' : '❌ NO'}`);
            console.log(`  - Captured "Review Diff" Constraint: ${gotConstraint ? '✅ YES' : '❌ NO'}`);
            console.log(`  - Captured "Keep JSDoc" Constraint: ${gotJSDoc ? '✅ YES' : '❌ NO'}`);
            console.log(`  - Ignored Abandoned "Split Helper" Plan: ${ignoredSplit ? '✅ YES' : '❌ NO'}`);

        } else {
            console.log('❌ Extraction failed (no result returned)');
        }
    } catch (error) {
        console.error('💥 Error running Ghost MAKER test:', error);
    }
}

const apiKey = process.argv[2] || process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('❌ Error: No API key provided');
    process.exit(1);
}

runGhostMaxTest(apiKey).catch(console.error);
