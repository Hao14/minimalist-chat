import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadWinstonContextSelection,
  normalizeWinstonContextSelection,
  prepareWinstonAttachments,
  releaseWinstonAttachment,
  releaseWinstonAttachments,
  saveWinstonContextSelection,
} from './winstonAdvancedServices.js';

export function useWinstonContextSelection(roomId = 'global') {
  const [selection, setSelectionState] = useState(() => loadWinstonContextSelection(roomId));
  const roomIdRef = useRef(roomId);

  useEffect(() => {
    if (roomIdRef.current === roomId) return undefined;
    roomIdRef.current = roomId;
    const timer = globalThis.setTimeout(() => {
      setSelectionState(loadWinstonContextSelection(roomId));
    }, 0);
    return () => globalThis.clearTimeout(timer);
  }, [roomId]);

  const setSelection = useCallback((value) => {
    setSelectionState((current) => {
      const next = normalizeWinstonContextSelection(
        typeof value === 'function' ? value(current) : value,
      );
      saveWinstonContextSelection(next, roomIdRef.current);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({
      roomIds: [],
      documentIds: [],
      personIds: [],
      dateRange: null,
      includeCurrentRoom: true,
      includeMemories: true,
      includeFullHistory: false,
    });
  }, [setSelection]);

  return { selection, setSelection, clearSelection };
}

export function useWinstonAttachments() {
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [attachmentProcessing, setAttachmentProcessing] = useState(false);
  const attachmentsRef = useRef([]);
  const processingRef = useRef(false);

  const publish = useCallback((next) => {
    attachmentsRef.current = next;
    setAttachments(next);
    return next;
  }, []);

  const selectAttachmentFiles = useCallback(async (files) => {
    if (processingRef.current) return false;
    processingRef.current = true;
    setAttachmentProcessing(true);
    setAttachmentError('');
    try {
      publish(await prepareWinstonAttachments(files, attachmentsRef.current));
      return true;
    } catch (error) {
      setAttachmentError(error?.message || 'Those files could not be attached.');
      return false;
    } finally {
      processingRef.current = false;
      setAttachmentProcessing(false);
    }
  }, [publish]);

  const removeAttachment = useCallback((attachmentId) => {
    publish(attachmentsRef.current.filter((attachment) => {
      if (attachment.id !== attachmentId) return true;
      releaseWinstonAttachment(attachment);
      return false;
    }));
    setAttachmentError('');
  }, [publish]);

  const detachAttachments = useCallback(() => {
    const current = attachmentsRef.current;
    publish([]);
    setAttachmentError('');
    return current;
  }, [publish]);

  const restoreAttachments = useCallback((value) => {
    const next = Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];
    releaseWinstonAttachments(attachmentsRef.current.filter((entry) => !next.includes(entry)));
    publish(next);
    setAttachmentError('');
  }, [publish]);

  const handleAttachmentPaste = useCallback((event) => {
    const files = [...(event.clipboardData?.files || [])].filter((file) => file.type?.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    selectAttachmentFiles(files);
  }, [selectAttachmentFiles]);

  useEffect(() => () => {
    releaseWinstonAttachments(attachmentsRef.current);
    attachmentsRef.current = [];
  }, []);

  return {
    attachments,
    attachmentError,
    attachmentProcessing,
    detachAttachments,
    handleAttachmentPaste,
    removeAttachment,
    restoreAttachments,
    selectAttachmentFiles,
  };
}
