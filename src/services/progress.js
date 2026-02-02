// Shared progress state to avoid circular dependencies
// This module can be imported by both scanner.js and ebay.js

export const progressState = {
    currentPhrase: '',
    currentPhraseIndex: 0,
    totalPhrases: 0,
    sellersProcessed: 0,
    totalSellers: 0,
    qualifiedSellers: 0
};

export function resetProgress() {
    progressState.currentPhrase = '';
    progressState.currentPhraseIndex = 0;
    progressState.totalPhrases = 0;
    progressState.sellersProcessed = 0;
    progressState.totalSellers = 0;
    progressState.qualifiedSellers = 0;
}

export function updatePhraseProgress(phrase, phraseIndex, totalPhrases) {
    progressState.currentPhrase = phrase;
    progressState.currentPhraseIndex = phraseIndex;
    progressState.totalPhrases = totalPhrases;
    progressState.sellersProcessed = 0;
    progressState.totalSellers = 0;
}

export function updateSellerProgress(sellersProcessed, totalSellers, qualifiedSellers) {
    progressState.sellersProcessed = sellersProcessed;
    progressState.totalSellers = totalSellers;
    progressState.qualifiedSellers = qualifiedSellers;
}
