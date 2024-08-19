/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import assert from 'assert'
import * as path from 'path'
import globals from '../../shared/extensionGlobals'
import fs from '../../shared/fs/fs'
import * as testUtil from '../testUtil'
import * as workspaceUtils from '../../shared/utilities/workspaceUtils'
import { toArrayAsync } from '../../shared/utilities/collectionUtils'
import { waitUntil } from '../../shared/utilities/timeoutUtils'
import { mapMetadata } from '../../shared/telemetry/telemetryLogger'

async function getMetrics(n: number, metricName: string, timeout = 1000) {
    return await waitUntil(
        async () => {
            const metrics = await toArrayAsync(
                globals.telemetry.findIter((m) => {
                    return m.MetricName === metricName
                })
            )
            return metrics.length >= n ? metrics : undefined
        },
        { interval: 200, timeout: timeout }
    )
}

describe('ide_editCodeFile telemetry', function () {
    let jsonUri1: vscode.Uri | undefined
    let jsonUri2: vscode.Uri | undefined
    let tsUri: vscode.Uri | undefined

    beforeEach(async function () {
        await testUtil.closeAllEditors()

        const jsonFile1 = workspaceUtils.tryGetAbsolutePath(
            vscode.workspace.workspaceFolders?.[0],
            'ts-plain-sam-app/tsconfig.json'
        )
        jsonUri1 = vscode.Uri.file(jsonFile1)

        const jsonFile2 = workspaceUtils.tryGetAbsolutePath(
            vscode.workspace.workspaceFolders?.[0],
            'ts-plain-sam-app/package.json'
        )
        jsonUri2 = vscode.Uri.file(jsonFile2)

        const tsFile = workspaceUtils.tryGetAbsolutePath(
            vscode.workspace.workspaceFolders?.[0],
            'ts-plain-sam-app/src/app.ts'
        )
        tsUri = vscode.Uri.file(tsFile)
    })

    after(async function () {
        await testUtil.closeAllEditors()
    })

    // TODO
    // it('is deduplicated up to 1 hour', async function () {})

    it('emits exactly once per filetype in a given flush window', async function () {
        await vscode.commands.executeCommand('vscode.open', tsUri)
        await vscode.commands.executeCommand('vscode.open', jsonUri1)
        // Different file, same extension (.json), thus `ide_editCodeFile` should be skipped/deduped.
        await vscode.commands.executeCommand('vscode.open', jsonUri2)
        // Wait for metrics...
        const r1 = await getMetrics(2, 'ide_editCodeFile')
        const m1 = r1?.[0]
        const m2 = r1?.[1]
        assert(m1?.Metadata)
        assert(m2?.Metadata)
        const metric1 = mapMetadata([])(m1.Metadata)
        const metric2 = mapMetadata([])(m2.Metadata)
        assert.deepStrictEqual(metric1['filenameExt'], '.ts')
        assert.deepStrictEqual(metric2['filenameExt'], '.json')

        await testUtil.closeAllEditors()
        await vscode.commands.executeCommand('vscode.open', jsonUri1)
        await vscode.commands.executeCommand('vscode.open', jsonUri2)

        // Get metrics again (result should be the same)...
        const r2 = await getMetrics(3, 'ide_editCodeFile')
        // Should not emit the "same" metric.
        assert.strictEqual(r2, undefined, 'emitted duplicate file_editAwsFile metric')
        // assert.strictEqual(r?.length, 1, 'emitted file_editAwsFile too many times')
    })
})

describe('file_editAwsFile telemetry', function () {
    let awsConfigUri: vscode.Uri | undefined
    let cfnUri: vscode.Uri | undefined

    beforeEach(async function () {
        await testUtil.closeAllEditors()

        // Create a dummy file in ~/.aws on the system.
        // Note: We consider _any_ file in ~/.aws to be an "AWS config" file,
        // so this will trigger "file_editAwsFile" telemetry.
        const awsConfigFile = path.join(fs.getUserHomeDir(), '.aws/test_awstoolkit')
        awsConfigUri = vscode.Uri.file(awsConfigFile)
        await testUtil.toFile('Test file from the aws-toolkit-vscode test suite.', awsConfigFile)

        const cfnFile = workspaceUtils.tryGetAbsolutePath(
            vscode.workspace.workspaceFolders?.[0],
            'python3.7-plain-sam-app/template.yaml'
        )
        cfnUri = vscode.Uri.file(cfnFile)
    })

    after(async function () {
        await testUtil.closeAllEditors()
    })

    it('emits when opened by user', async function () {
        await vscode.commands.executeCommand('vscode.open', cfnUri)
        await vscode.commands.executeCommand('vscode.open', awsConfigUri)
        await vscode.workspace.openTextDocument({
            content: 'test content for SSM JSON',
            language: 'ssm-json',
        })

        const r = await getMetrics(3, 'file_editAwsFile', 5000)

        assert(r, 'did not emit expected telemetry')
        assert(r.length === 3, 'emitted file_editAwsFile too many times')
        const metrics = r.map((o) => o.Metadata?.find((o) => o.Key === 'awsFiletype')?.Value)
        // The order is arbitrary (decided by vscode event system).
        metrics.sort()
        assert.deepStrictEqual(metrics, ['awsCredentials', 'cloudformationSam', 'ssmDocument'])
    })

    it('emits exactly once per filetype in a given flush window', async function () {
        await vscode.commands.executeCommand('vscode.open', cfnUri)
        // Wait for metrics...
        await getMetrics(1, 'file_editAwsFile')
        await testUtil.closeAllEditors()
        await vscode.commands.executeCommand('vscode.open', cfnUri)
        await vscode.commands.executeCommand('vscode.open', cfnUri)

        // Get metrics again (result should be the same)...
        const r = await getMetrics(2, 'file_editAwsFile')
        // Should not emit the "same" metric.
        assert.strictEqual(r, undefined, 'emitted duplicate file_editAwsFile metric')
        // assert.strictEqual(r?.length, 1, 'emitted file_editAwsFile too many times')
    })
})
