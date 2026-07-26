'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { submitManualStory } from '../../lib/manualSubmission';

const MAX_FEEDBACK_MESSAGE_LENGTH = 1_500;

function feedbackUrl(path: string, kind: 'notice' | 'error', message: string): string {
  const safeMessage = message.length <= MAX_FEEDBACK_MESSAGE_LENGTH
    ? message
    : `${message.slice(0, MAX_FEEDBACK_MESSAGE_LENGTH - 1)}…`;
  return `${path}?${new URLSearchParams({ [kind]: safeMessage })}`;
}

export async function submitStoryUrl(formData: FormData) {
  let result: Awaited<ReturnType<typeof submitManualStory>>;
  try {
    result = await submitManualStory(formData.get('url'));
  } catch (error) {
    console.error('[desk] submit story failed', error);
    redirect(feedbackUrl('/review', 'error', 'Could not submit that story right now. Please try again.'));
  }

  if (!result.ok) {
    redirect(feedbackUrl('/review', 'error', result.error));
  }

  if (result.queue.outcome === 'deleted') {
    redirect(
      feedbackUrl(
        '/review',
        'error',
        'That URL was previously deleted and will not be added again.'
      )
    );
  }

  if (result.queue.outcome === 'duplicate') {
    redirect(
      feedbackUrl(
        `/review/${result.queue.id}`,
        'notice',
        `That URL is already article #${result.queue.id} (${result.queue.status}).`
      )
    );
  }

  revalidatePath('/review');
  redirect(
    feedbackUrl(
      `/review/${result.queue.id}`,
      'notice',
      'Story submitted. It is queued for the same processing flow as a feed item.'
    )
  );
}
