// conditions.js
export const EBAY_CONDITIONS = {
    NEW: {
        id: '1000',
        name: 'New',
        variants: ['New', 'New with tags']
    },
    NEW_OTHER: {
        id: '1500',
        name: 'New other (see details)',
        variants: ['New other (see details)', 'New without tags']
    },
    NEW_WITH_DEFECTS: {
        id: '1750',
        name: 'New with defects',
        variants: ['New with defects']
    },
    CERTIFIED_REFURBISHED: {
        id: '2000',
        name: 'Certified - Refurbished',
        variants: ['Certified - Refurbished']
    },
    EXCELLENT_REFURBISHED: {
        id: '2010',
        name: 'Excellent - Refurbished',
        variants: ['Excellent - Refurbished']
    },
    VERY_GOOD_REFURBISHED: {
        id: '2020',
        name: 'Very Good - Refurbished',
        variants: ['Very Good - Refurbished']
    },
    GOOD_REFURBISHED: {
        id: '2030',
        name: 'Good - Refurbished',
        variants: ['Good - Refurbished']
    },
    SELLER_REFURBISHED: {
        id: '2500',
        name: 'Seller refurbished',
        variants: ['Seller refurbished']
    },
    LIKE_NEW: {
        id: '2750',
        name: 'Like New',
        variants: ['Like New']
    },
    USED: {
        id: '3000',
        name: 'Used',
        variants: ['Used', 'Pre-owned']
    },
    VERY_GOOD: {
        id: '4000',
        name: 'Very Good',
        variants: ['Very Good']
    },
    GOOD: {
        id: '5000',
        name: 'Good',
        variants: ['Good']
    },
    ACCEPTABLE: {
        id: '6000',
        name: 'Acceptable',
        variants: ['Acceptable']
    },
    FOR_PARTS: {
        id: '7000',
        name: 'For parts or not working',
        variants: ['For parts or not working']
    }
};

// Helper function to get condition name by ID
export function getConditionNameById(id) {
    const condition = Object.values(EBAY_CONDITIONS).find(c => c.id === id);
    return condition ? condition.name : 'Unknown';
}

// Helper function to format conditions for API query
//export function formatConditionsForQuery(conditionIds) {
//    return conditionIds.join('|');
//}

// Helper function to get all condition options for frontend
//export function getAllConditionOptions() {
//    return Object.values(EBAY_CONDITIONS).map(condition => ({
//        id: condition.id,
//        name: condition.name
//    }));
//}