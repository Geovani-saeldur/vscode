/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';
import { ILogService } from 'vs/platform/log/common/log';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { ITextFileSaveParticipant, IResolvedTextFileEditorModel } from 'vs/workbench/services/textfile/common/textfiles';
import { SaveReason } from 'vs/workbench/common/editor';
import { IDisposable, Disposable, toDisposable } from 'vs/base/common/lifecycle';

export class TextFileSaveParticipant extends Disposable {

	private readonly saveParticipants: ITextFileSaveParticipant[] = [];

	constructor(
		@IProgressService private readonly progressService: IProgressService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	addSaveParticipant(participant: ITextFileSaveParticipant): IDisposable {
		this.saveParticipants.push(participant);

		return toDisposable(() => this.saveParticipants.splice(this.saveParticipants.indexOf(participant), 1));
	}

	participate(model: IResolvedTextFileEditorModel, context: { reason: SaveReason; }, token: CancellationToken): Promise<void> {
		const cts = new CancellationTokenSource(token);

		return this.progressService.withProgress({
			title: localize('saveParticipants', "Running Save Participants for '{0}'", model.name),
			location: ProgressLocation.Notification,
			cancellable: true,
			delay: model.isDirty() ? 3000 : 5000
		}, async progress => {

			// undoStop before participation
			model.textEditorModel.pushStackElement();

			for (const saveParticipant of this.saveParticipants) {
				if (cts.token.isCancellationRequested) {
					break;
				}

				try {
					const promise = saveParticipant.participate(model, context, progress, cts.token);
					await raceCancellation(promise, cts.token);
				} catch (err) {
					this.logService.warn(err);
				}
			}

			// undoStop after participation
			model.textEditorModel.pushStackElement();
		}, () => {
			// user cancel
			cts.dispose(true);
		});
	}

	dispose(): void {
		this.saveParticipants.splice(0, this.saveParticipants.length);
	}
}
