const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const getFollowingPeopleIdsOfUser = async (username) => {
  const getTheFollowingPeopleQuery = `
    SELECT following_user_id FROM follower
    INNER JOIN user ON user_id = follower.follower_user_id
    WHERE user.username = '${username}';`;

  const followingPeople = await database.all(getTheFollowingPeopleQuery);
  const arrayOfIds = followingPeople.map((each) => each.following_user_id);
  return arrayOfIds;
};

const authenticationToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader) {
    jwtToken = authHeader.split(" ")[1];
  }

  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "SECRETE_KEY", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id 
    WHERE tweet.tweet_id = '${tweetId}' AND follower_user_id = '${userId}';`;

  const tweet = await database.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  }
};

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}'`;
  const userDBDetails = await database.get(getUserQuery);

  if (userDBDetails !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `INSERT INTO user(username,password,name,gender)
       VALUES('${username}','${hashedPassword}','${name}','${gender}')`;
      await database.run(createUserQuery);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const userDbDetails = await database.get(getUserQuery);

  if (userDbDetails !== undefined) {
    const isPasswordMatched = await bcrypt.compare(
      password,
      userDbDetails.password
    );
    if (isPasswordMatched === true) {
      const payload = { username, userId: userDbDetails.user_id };
      const jwtToken = jwt.sign(payload, "SECRETE_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

app.get(
  "/user/tweets/feed/",
  authenticationToken,
  async (request, response) => {
    const { username } = request;
    const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
    const getTweetFeedsQuery = `SELECT username, tweet, date_time as dateTime
    FROM user INNER JOIN tweet ON user.user_id = tweet.user_id
    WHERE user.user_id IN (${followingPeopleIds})
    ORDER BY date_time DESC
    LIMIT 4;`;

    const tweetFeedArray = await database.all(getTweetFeedsQuery);
    response.send(tweetFeedArray);
  }
);

app.get("/user/following/", authenticationToken, async (request, response) => {
  const { userId, username } = request;
  const userFollowsQuery = `SELECT name FROM follower INNER JOIN user ON user.user_id = follower.following_user_id WHERE follower.follower_user_id = '${userId}';`;
  const userFollowsArray = await database.all(userFollowsQuery);
  response.send(userFollowsArray);
});

app.get("/user/followers/", authenticationToken, async (request, response) => {
  const { userId, username } = request;
  const userFollowsQuery = `SELECT DISTINCT name FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id WHERE following_user_id = '${userId}';`;
  const userFollowsArray = await database.all(userFollowsQuery);
  response.send(userFollowsArray);
});

app.get("/tweets/:tweetId/", authenticationToken, async (request, response) => {
  const { tweetId } = request.params;
  const { userId, username } = request;
  const getTweetQuery = `SELECT tweet, 
    (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
    (SELECT COUNT() FROM reply WHERE tweet_id = '${tweetId}') AS replies,
    date_time AS dateTime
    FROM tweet
    WHERE tweet.tweet_id = '${tweetId}';`;
  const tweetDetails = await database.get(getTweetQuery);
  response.send(tweetDetails);
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticationToken,
  async (request, response) => {
    const { tweetId } = request.params;

    const getLikedUsersQuery = `SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id WHERE tweet_id = '${tweetId}';`;
    const likedUsers = await database.all(getLikedUsersQuery);

    const usersArray = likedUsers.map((each) => each.username);
    response.send({ likes: usersArray });
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticationToken,
  async (request, response) => {
    const { tweetId } = request.params;

    const getLikedUsersQuery = `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id WHERE tweet_id = '${tweetId}';`;
    const likedUsers = await database.all(getLikedUsersQuery);

    response.send({ replies: likedUsers });
  }
);

app.get("/user/tweets/", authenticationToken, async (request, response) => {
  const { userId } = request;
  const getTweetDetailsQuery = `SELECT tweet, COUNT(DISTINCT(like_id)) AS likes,
                                                        COUNT(DISTINCT(reply_id)) AS replies,
                                                        date_time AS dateTime
                                                        FROM tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON tweet.tweet_id = like.tweet_id 
                                                        WHERE tweet.user_id = '${userId}'
                                                        GROUP BY tweet.tweet_id;`;
  const tweetDetails = await database.all(getTweetDetailsQuery);
  response.send(tweetDetails);
});

app.post("/user/tweets/", authenticationToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().subscribe(0, 19).replace("T", " ");
  const postTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time) VALUES('${tweet}','${userId}','${dateTime}');`;
  await database.run(postTweetQuery);
  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticationToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;

    const selectUserQuery = `SELECT * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`;
    const tweetUser = await database.all(selectUserQuery);
    if (tweetUser === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
