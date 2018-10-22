const express = require('express');
const router = express.Router();

const jwt = require('jwt-simple');
const config = require('../config/jwt-config');

const database = require('../model/pool');

const now = () => {
    return new Date().toLocaleString();;
}

const authToken = (token) => {
    return new Promise((resolve, reject) => {
        if (!token)
            reject({error: 'x-access-token required'})
        resolve(jwt.decode(token,require('../config/jwt-config').jwtSecret).id);
    })
}

router.put('/', (req, res) => {    
    const token = req.headers['x-access-token'];    
    if(!token)
        return res.status(401).json({ success: false, message: 'not logged in'});
    const user_id = jwt.decode(token, config.jwtSecret).id;
    
    const { title, content } = req.body;
    const game_id = req.body.game_id || 0;

    const sql = `INSERT INTO posts(user_id, title, content, game_id, create_date, update_date) VALUES ( '${user_id}', '${title}', '${content}', '${game_id}', '${now()}', '${now()}')`;
    database.query(sql)
    .then(() => res.status(201))
    .catch(err => res.status(403).json(err));
})

router.get('/count', (req, res) => {
    const { title, game_id } = req.query;
    let query = `
    SELECT COUNT(*) count
    FROM posts `
    if(title && game_id) res.status(400).json({error: 'Too many queries'})
    if(title && title !== '자유') query += `WHERE game_id = (SELECT id FROM games WHERE title = '${title}')`
    if(game_id) query += `WHERE game_id = '${game_id}')`
    database.query(query)
    .then(rows => res.status(200).json(rows[0]))
    .catch(err => res.status(400).json(err))
})

router.get('/list', (req, res) => {
    const { title, game_id, sort } = req.query;
    const count_per_page = req.query.count || 10;
    const page_number = req.query.page || 1;
    let query =`
    SELECT
        posts.id,
        posts.game_id,
        posts.title,
        accounts.name,
        posts.content,
        posts.views,
        posts.update_date AS date,
        IFNULL((SELECT title FROM games WHERE id = posts.game_id),"자유") category,
        (SELECT COUNT(*) FROM recommends WHERE post_id = posts.id) recommends,
        (SELECT COUNT(*) FROM post_comments WHERE post_id = posts.id) comment_count
    FROM posts
    LEFT JOIN accounts
    ON posts.user_id = accounts.id `
    if (title && title !== '자유') {
        query += `WHERE posts.game_id = (SELECT id FROM games WHERE title = '${title}')`
    }
    if (game_id) {
        query += `WHERE posts.game_id='${game_id}' `;
    }
    switch (sort) {
        case 'popular':
            query += `ORDER BY views DESC `
            break;
        case 'recommend' :
            query += `ORDER BY recommend ASC `;
            break;
        case 'recent' :
            query += `ORDER BY posts.update_date DESC `;
            break;
        default:
            break;
    }
    query += `LIMIT ${(page_number-1) * count_per_page}, ${count_per_page}`;
    database.query(query)
    .then(rows => {
        res.status(200).json(rows);
    })
    .catch(err => res.status(400).json(err));
})

//id에 해당하는 post를 불러옴
router.get('/', (req, res) => {
    const { game, id } = req.query;

    database.query(`UPDATE posts SET views = views + 1 WHERE id='${id}'`);
    let query = `
    SELECT posts.id,
        posts.title, 
        users.name, 
        posts.content, 
        posts.views, 
        posts.update_date,
        (SELECT COUNT(*) FROM recommends WHERE post_id = posts.id) recommend
    FROM posts
    JOIN accounts AS users
    ON posts.user_id = users.id
    WHERE `
    if(game)query += `posts.game_id = (SELECT id FROM games WHERE title = '${game}') AND `
    if(id)  query += `posts.id = '${id}'`
    else return res.status(400).json({error: 'query.id required'})
    database.query(query)
    .then(rows => res.status(200).json(rows))
    .catch(err => res.status(400).json(err))
})

router.post('/', (req, res) => {
    const token = req.headers['x-access-token'];
    if(!token)
        return res.status(401).json({ success: false, message: 'not logged in'});
    const { id, title, content } = req.body;
    if(id != jwt.decode(token, config.jwtSession))
        return res.status(401).json({ success: false, message: 'unauthenticated' })
    const query = `UPDATE posts SET title = '${title}' content = '${content}' WHERE id = '${id}'`;
    database.query(query)
    .then(() => res.status(201))
    .catch(err => res.status(400).json(err));
})

router.delete('/', (req, res) => {
    const token = req.headers['x-access-token'];
    if(!token)
        return res.status(401).json({ success: false, message: 'not logged in'});
    const id = req.body.id;
    const user_id = jwt.decode(token, config.jwtSession);
    if(id != user_id)
        return res.status(401).json({ success: false, message: 'unauthenticated' })
    const query = `DELETE FROM posts WHERE user_id = '${user_id}' AND id = '${id}'`;
    database.query(query)
    .then(() => res.status(200))
    .catch(err => res.status(400).json(err));
})

router.post('/recommend', (req, res) => {    
    const token = req.headers['x-access-token'];
    if(!token)
        return res.status(401).json({ error: 'not logged in'});
    const user_id = jwt.decode(token, config.jwtSecret).id;
    const { id } = req.query;
    console.log(id);
    console.log(token);
    //FIXME: change to database.unique
    
    database.query(`SELECT EXISTS (SELECT * FROM recommends WHERE post_id = '${id}' AND user_id = '${user_id}') as success`)
    .then(rows => {
        if (rows[0].success)
            return database.query(`DELETE FROM recommends WHERE post_id = '${id}' AND user_id = '${user_id}'`);
        else
            return database.query(`INSERT INTO recommends (post_id, user_id) VALUES ('${id}', '${user_id}') `);
    })
    .then(() => {
        res.status(200);
    })
    .catch(err => res.status(400).json({ error: err }))
});

router.post('/disrecommend', (req, res) => {
    const token = req.headers['x-access-token'];
    if(!token)
        return res.status(401).json({ error: 'not logged in'});
    const user_id = jwt.decode(token, config.jwtSecret);
    const { id } = req.body;

    //FIXME: change to database.unique
    database.query(`SELECT EXISTS (SELECT * FROM disrecommends WHERE post_id = '${id}' AND user_id = '${user_id}') as success`)
    .then(rows => {
        if (rows[0].success)
            return database.query(`DELETE FROM disrecommends WHERE post_id = '${id}' AND user_id = '${user_id}'`);
        else
            return database.query(`INSERT INTO disrecommends (post_id, user_id) VALUES ('${id}', '${user_id}') `);
    })
    .then(() => {
        res.status(200);
    })
    .catch(err => res.status(400).json({ error: err }))
});

router.post('/comments', (req, res) => {
    const token = req.headers['x-access-token'];
        
    const { value, id } = req.body;
    
    if (!id)
        res.status(400).json({error: 'id required'})
    authToken(token)
    .then(user_id => {
        const sql = `INSERT INTO post_comments (user_id, value, post_id) VALUES ('${user_id}', '${value}', '${id}')`;
        return database.query(sql)
    })
    .then(() => res.status(201))
    .catch(err => res.status(400).json(err))
})

router.get('/comments/count', (req, res) => {
    const { id } = req.query;
    let sql = `
    SELECT COUNT(*) AS count
    FROM post_comments `
    if (id)    sql += `WHERE post_id='${id}'`;
    database.query(sql)
    .then(rows => res.status(200).json(rows[0]))
    .catch(err => res.status(400).json(err))
})

router.get('/comments', (req, res) => {
    const { id, offset, limit } = req.query;
    if(!offset) offset = 1;
    if(!limit) length = 10;
    const sql = `
    SELECT comment.id, user.name, comment.value, comment.update_date
    FROM post_comments AS comment
    LEFT JOIN accounts AS user
    ON comment.user_id = user.id
    WHERE comment.post_id = '${id}'
    ORDER BY comment.update_date DESC
    LIMIT ${limit} OFFSET ${offset}`
    database.query(sql)
    .then(rows => res.status(200).json(rows))
    .catch(err => res.status(400).json(err))
})


//FIXME: this is Experimental function
router.put('/comments', (req, res) => {
    const token = req.headers['x-access-token'];
    //const user_id = 
    const { id, value } = req.body;
    const update_comment = (user_id) => {
        return database.query(`UPDATE post_comments SET id='${id}', value='${value}' WHERE user_id='${user_id}'`)
    }
    const success = () => {
        res.status(200).json({ success: true });
    }
    const error = (err) => {
        res.status(400).json({ success: false, message: err });
    }
    authToken(token)
    .then(update_comment)
    .then(success)
    .catch(error)
})

router.delete('/comments', (req, res) => {
    const token = req.headers['x-access-token'];
    const { id } = req.body;
    const delete_comment = (user_id) => {
        return database.query(`DELETE FROM post_comments WHERE id='${id}' AND user_id='${user_id}'`)
    }
    const success = () => {
        res.status(200).json({ success: true });
    }
    const error = (err) => {
        res.status(400).json({ success: false, message: err });
    }
    authToken(token)
    .then(delete_comment)
    .then(success)
    .catch(error)
})

module.exports = router;