// conditions.js
export const EBAY_CONDITIONS = {
    NEW: {
        id: '1000',
        name: 'New'
    },
    NEW_OTHER: {
        id: '1500',
        name: 'New other (see details)'
    },
    NEW_WITH_DEFECTS: {
        id: '1750',
        name: 'New with defects'
    },
    CERTIFIED_REFURBISHED: {
        id: '2000',
        name: 'Certified - Refurbished'
    },
    EXCELLENT_REFURBISHED: {
        id: '2010',
        name: 'Excellent - Refurbished'
    },
    VERY_GOOD_REFURBISHED: {
        id: '2020',
        name: 'Very Good - Refurbished'
    },
    GOOD_REFURBISHED: {
        id: '2030',
        name: 'Good - Refurbished'
    },
    SELLER_REFURBISHED: {
        id: '2500',
        name: 'Seller refurbished'
    },
    LIKE_NEW: {
        id: '2750',
        name: 'Like New'
    },
    USED: {
        id: '3000',
        name: 'Used'
    },
    VERY_GOOD: {
        id: '4000',
        name: 'Very Good'
    },
    GOOD: {
        id: '5000',
        name: 'Good'
    },
    ACCEPTABLE: {
        id: '6000',
        name: 'Acceptable'
    },
    FOR_PARTS: {
        id: '7000',
        name: 'For parts or not working'
    }
};

// Helper function to get condition name by ID
export function getConditionNameById(id) {
    const condition = Object.values(EBAY_CONDITIONS).find(c => c.id === id);
    return condition ? condition.name : 'Unknown';
}

// Helper function to format conditions for API query
export function formatConditionsForQuery(conditionIds) {
    // Map from condition IDs to their ENUM keys
    const idToEnum = Object.entries(EBAY_CONDITIONS).reduce((map, [enumKey, condition]) => {
        map[condition.id] = enumKey;
        return map;
    }, {});
    
    // Convert IDs to ENUM values and join with commas
    return conditionIds
        .map(id => idToEnum[id])
        .filter(Boolean)  // Remove any undefined values
        .join(',');
}

// Helper function to get all condition options for frontend
export function getAllConditionOptions() {
    return Object.values(EBAY_CONDITIONS).map(condition => ({
        id: condition.id,
        name: condition.name
    }));
}