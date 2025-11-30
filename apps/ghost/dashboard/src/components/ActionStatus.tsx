import type { ActionResult } from '../types';

interface Props {
  result: ActionResult;
}

export function ActionStatus({ result }: Props) {
  const isSuccess = result.status === 'success';
  const { action } = result;

  const renderDetails = () => {
    if (action.type === 'info.summarize') {
      const topic = action.params?.topic || '—';
      const format = action.params?.format || 'timeline';
      const sources: string[] = Array.isArray(action.params?.sources) ? action.params.sources : [];
      return (
        <div className="action-details">
          <div className="detail-line"><strong>Topic:</strong> {topic}</div>
          <div className="detail-line"><strong>Format:</strong> {format}</div>
          <div className="detail-line"><strong>Sources:</strong> {sources.length}</div>
        </div>
      );
    }

    if (action.type === 'file.scroll') {
      const dir = action.params?.direction || '—';
      const amt = action.params?.amount ? `${action.params.amount}` : '';
      return (
        <div className="action-details">
          <div className="detail-line"><strong>Direction:</strong> {dir} {amt && `(${amt})`}</div>
        </div>
      );
    }

    if (action.type === 'file.open') {
      const path = action.params?.path || '—';
      return (
        <div className="action-details">
          <div className="detail-line"><strong>Path:</strong> {path}</div>
        </div>
      );
    }

    if (action.type === 'info.recall') {
      const summary = action.params?.summary || '';
      return (
        <div className="action-details">
          <div className="detail-line"><strong>Summary:</strong> {summary}</div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="action">
      <div className="action-type">{action.type}</div>
      <div className={`pill ${isSuccess ? 'success' : 'failed'}`}>
        {isSuccess ? 'success' : 'failed'}
      </div>
      {!isSuccess && result.error && <div className="action-error">{result.error}</div>}
      {renderDetails()}
    </div>
  );
}
