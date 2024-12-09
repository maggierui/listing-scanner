import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import fetchAccessToken from './auth.js';
import fs from 'fs/promises';

async function getEbayCategories() {
    try {
        const token = await fetchAccessToken();
        const categoryTreeId = 0;
        
        const response = await fetch(
            `https://api.ebay.com/commerce/taxonomy/v1/category_tree/${categoryTreeId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const categories = [];

        // Function to recursively process categories
        function processCategoryNode(node, level = 0) {
            if (!node || !node.category) {
                return;
            }

            const indent = '  '.repeat(level);
            const { categoryId, categoryName } = node.category;
            console.log(`${indent}${categoryId}: ${categoryName}`);
            
            // Add to our categories array
            categories.push({
                categoryId,
                categoryName,
                level,
                isLeaf: node.leafCategoryTreeNode || false
            });
            
            // Check for child categories
            if (node.childCategoryTreeNodes && Array.isArray(node.childCategoryTreeNodes)) {
                node.childCategoryTreeNodes.forEach(childNode => {
                    processCategoryNode(childNode, level + 1);
                });
            }
        }

        // Process the root category node
        console.log('=== eBay Category Hierarchy ===\n');
        
        if (data.categoryTreeNode) {
            processCategoryNode(data.categoryTreeNode);
        } else if (data.rootCategoryNode) {
            processCategoryNode(data.rootCategoryNode);
        } else {
            console.error('No category tree node found in response');
            console.log('Available keys in response:', Object.keys(data));
        }

        // Save categories to files
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Save as JSON
        await fs.writeFile(
            `ebay_categories_${timestamp}.json`,
            JSON.stringify(categories, null, 2)
        );
        console.log(`\nCategories saved to ebay_categories_${timestamp}.json`);

        // Save as CSV
        const csvContent = [
            'Category ID,Category Name,Level,Is Leaf',
            ...categories.map(cat => 
                `${cat.categoryId},"${cat.categoryName}",${cat.level},${cat.isLeaf}`
            )
        ].join('\n');
        
        await fs.writeFile(
            `ebay_categories_${timestamp}.csv`,
            csvContent
        );
        console.log(`Categories saved to ebay_categories_${timestamp}.csv`);

        return categories;

    } catch (error) {
        console.error('Error fetching eBay categories:', error);
        throw error;
    }
}

// If running this file directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    getEbayCategories()
        .then(() => console.log('\nCategory fetch complete'))
        .catch(error => console.error('Failed to fetch categories:', error));
}

export { getEbayCategories };