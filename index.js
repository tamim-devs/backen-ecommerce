
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs");
const nodemailer = require("nodemailer");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;



app.use(
  cors({
    credentials: true,
    origin: [process.env.NEXT_PUBLIC_URL],
  })
);

app.use(express.json());



const uri = process.env.MONGO_DB_URI;

const JWKS = createRemoteJWKSet(new URL(`${process.env.NEXT_PUBLIC_URL}/api/auth/jwks`)) 



const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth : {
    user:process.env.EMAIL_USER,
    pass:process.env.EMAIL_PASSWORD
  }
})



const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const logger = (req,res,next) =>{
console.log(req.params,'from post')
next()
}




const verityToken = async(req,res,next)=>{
  try {
    const authHeader  = req.headers.authorization

     if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      msg: "Unauthorized",
    });
  }

  const token = authHeader.split(" ")[1]


  if (!token) {
    return res.status(401).json({message: 'Unauthorized'})
  }

  const { payload } = await jwtVerify(token, JWKS)
  
     console.log("Token validation successful!");
    console.log("Token payload:", payload);
   req.user = payload;

    next();
} catch (error) {
  console.error('Token validation failed:', error)
     return res.status(401).json({
      msg: "Unauthorized",
    });
}
}

const verifyAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      message: "Forbidden: Admin access required",
    });
  }

  next();
};

const verifySeller = (req, res, next) => {
  if (req.user?.role !== "buyer") {
    return res.status(403).json({
      message: "Forbidden: Seller access required",
    });
  }

  next();
};


async function run() {
  try {
    // await client.connect();
    const db  = client.db(process.env.AUTH_DB_NAME);
    
const productsCollection = db.collection("products");
const ordersCollection = db.collection("orders");
const usersCollection = db.collection("user");

   
app.get("/products", async (req, res) => {
  try {
    const {
      search = "",
      category = "",
      page = "1",
      limit = "12",
    } = req.query;

    // Validate pagination
    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageLimit = Math.min(
      100,
      Math.max(1, parseInt(limit, 10) || 12)
    );

    const skip = (currentPage - 1) * pageLimit;

    // Build MongoDB query
    const query = {};

    // Search by product name
    if (search.trim()) {
      query.name = {
        $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        $options: "i",
      };
    }

    // Filter by category
    if (category.trim() && category.toLowerCase() !== "all") {
      query.category = category.trim();
    }

    // Fetch products and total count together
    const [products, totalProducts] = await Promise.all([
      productsCollection
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(pageLimit)
        .toArray(),

      productsCollection.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalProducts / pageLimit);

    return res.status(200).json({
      success: true,
      products,
      pagination: {
        currentPage,
        limit: pageLimit,
        totalProducts,
        totalPages,
        hasNextPage: currentPage < totalPages,
        hasPrevPage: currentPage > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching products:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch products.",
    });
  }
});

app.post("/api/send-email", async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    // Required fields
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, email and message are required",
      });
    }

    const mailOption = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      replyTo: email,
      subject: `New Contact: ${subject || "No Subject"}`,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <h2>New Contact Message</h2>

          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Phone:</strong> ${phone || "Not provided"}</p>
          <p><strong>Subject:</strong> ${subject || "No Subject"}</p>

          <hr />

          <h3>Message:</h3>
          <p>${message}</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOption);

    res.status(200).json({
      success: true,
      message: "Contact email sent successfully",
    });

  } catch (error) {
    console.error("Contact email error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to send contact email",
    });
  }
});




     app.get('/admin/products',verifyAdmin, async (req, res) => {
      try {
        const products = await productsCollection.find();
        const result = await products.toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    })  

    
app.get("/admin/orders",verityToken, verifyAdmin,   async (req, res) => {
  try {
    const orders = await ordersCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);

    return res.status(500).json({
      message: "Failed to fetch orders.",
    });
  }
});


app.patch(
  "/admin/orders/:orderId/status",
  verityToken,
  verifyAdmin,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { status } = req.body;

      const allowedStatuses = [
        "pending",
        "confirmed",
        "shipped",
        "delivered",
        "cancelled",
      ];

      if (!ObjectId.isValid(orderId)) {
        return res.status(400).json({
          message: "Invalid order ID.",
        });
      }

      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid order status.",
        });
      }

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(orderId) },
        {
          $set: {
            status,
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          message: "Order not found.",
        });
      }

      return res.status(200).json({
        message: "Order status updated successfully.",
        orderId,
        status,
      });
    } catch (error) {
      console.error("Error updating order status:", error);

      return res.status(500).json({
        message: "Failed to update order status.",
      });
    }
  }
);

    app.get('/featured-products', async (req, res) => {
      try {
        const products = await productsCollection.find().limit(6);
        const result = await products.toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    })


    app.get('/products/:productId',logger, async(req, res)=>{
      try {
        const productId = req.params.productId;
        const query = {_id: new ObjectId(productId)}
        const result = await productsCollection.findOne(query)
        res.send(result)
      }catch (error) {
        console.error("Error fetching product by ID:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    })

    
    app.post('/products',verityToken,verifyAdmin, async(req,res)=>{
    try {
      const newProduct = req.body
      const result = await productsCollection.insertOne(newProduct)
      res.send(result)
    } catch (error) {
          console.error("Error post product :", error);
        res.status(500).json({ error: "Internal server error post" });

    }
    })

    

   
app.post("/orders", verityToken,verifySeller, async (req, res) => {
  

  try {
    const { customer, items } = req.body;

  
    if (
      !customer ||
      typeof customer.name !== "string" ||
      !customer.name.trim() ||
      typeof customer.phone !== "string" ||
      !customer.phone.trim() ||
      typeof customer.location !== "string" ||
      !customer.location.trim()
    ) {
      return res.status(400).json({
        message: "Name, phone number, and delivery address are required.",
      });
    }

    const phone = customer.phone.trim();

  
   

    const authenticatedUserId = req.user?.sub;

if (!authenticatedUserId) {
  return res.status(401).json({
    message: "User ID is missing from the authentication token.",
  });
}

let user = null;

// First: Better Auth user ID stored as MongoDB ObjectId
if (ObjectId.isValid(authenticatedUserId)) {
  user = await usersCollection.findOne({
    _id: new ObjectId(authenticatedUserId),
  });
}

// Fallback: user ID stored as a string
if (!user) {
  user = await usersCollection.findOne({
    id: authenticatedUserId,
  });
}

if (!user) {
  console.log("User lookup failed.");
  console.log("Token subject:", authenticatedUserId);
  console.log("Database:", process.env.AUTH_DB_NAME);
  console.log("Collection: user");

  return res.status(404).json({
    message: "User not found. Check the database and user ID schema.",
  });
}

    const orderItems = [];
    let totalPrice = 0;

    for (const item of items) {
      if (
        !item.productId ||
        !ObjectId.isValid(item.productId) ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1
      ) {
        return res.status(400).json({
          message: "Invalid product or quantity.",
        });
      }

      const product = await productsCollection.findOne({
        _id: new ObjectId(item.productId),
      });

      if (!product) {
  return res.status(404).json({
    message: "A product in your cart was not found.",
  });
} 

const stockResult = await productsCollection.updateOne(
  {
    _id: product._id,
    stock: { $gte: item.quantity },
    isAvailable: { $ne: false },
  },
  {
    $inc: { stock: -item.quantity },
  }
);

if (stockResult.modifiedCount !== 1) {
  return res.status(400).json({
    message: `${product.name} has insufficient stock.`,
  });
}

      const stock = Number(product.stock);
      const regularPrice = Number(product.price);
      const discountPrice = Number(product.discountPrice);

      if (
        product.isAvailable === false ||
        !Number.isFinite(stock) ||
        stock < item.quantity
      ) {
        return res.status(400).json({
          message: `${product.name} is unavailable or has insufficient stock.`,
        });
      }

      if (!Number.isFinite(regularPrice) || regularPrice < 0) {
        return res.status(400).json({
          message: `Invalid price for ${product.name}.`,
        });
      }

      const price =
        product.discountPrice != null &&
        Number.isFinite(discountPrice) &&
        discountPrice >= 0 &&
        discountPrice < regularPrice
          ? discountPrice
          : regularPrice;

      const subtotal = price * item.quantity;

      orderItems.push({
        productId: product._id,
        name: product.name,
        image: product.image || "",
        price,
        quantity: item.quantity,
        subtotal,
      });

      totalPrice += subtotal;
    }

    const newOrder = {
       userId: user._id.toString(),
      customer: {
        name: customer.name.trim(),
        phone,
        location: customer.location.trim(),
      },
      items: orderItems,
      totalPrice,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    console.log("About to insert order:", newOrder);

    const result = await ordersCollection.insertOne(newOrder);

    console.log("Order inserted successfully:", result.insertedId);

    return res.status(201).json({
      message: "Order placed successfully.",
      orderId: result.insertedId,
      userId: user.id,
      totalPrice,
      status: newOrder.status,
    });
  } catch (error) {
    console.error("POST /orders error:", error);

    return res.status(500).json({
      message: "Failed to create order.",
    });
  }
});



app.get("/my/orders", verityToken, verifySeller, async (req, res) => {
  try {
    const authenticatedUserId = req.user?.sub;

    if (!authenticatedUserId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    let user = null;

    if (ObjectId.isValid(authenticatedUserId)) {
      user = await usersCollection.findOne({
        _id: new ObjectId(authenticatedUserId),
      });
    }

    if (!user) {
      user = await usersCollection.findOne({
        id: authenticatedUserId,
      });
    }

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const orders = await ordersCollection
      .find({ userId: user._id.toString() })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).json(orders);
  } catch (error) {
    console.error("GET /my/orders error:", error);

    return res.status(500).json({
      message: "Failed to fetch your orders",
    });
  }
});
    app.patch('/products/:productId',async(req,res)=>{
      const  productId = req.params.productId
      const updateData = req.body
      const filter = {_id: new ObjectId(productId)}
      const updateDoc = {
        $set: {
          ...updateData,

      }
      }
      const result = await productsCollection.updateOne(filter,updateDoc)
      res.send(result)
    })

    app.delete('/products/:productId', async(req,res)=>{
      const productId = req.params.productId
      const query = {_id: new ObjectId(productId)}
      const result = await productsCollection.deleteOne(query)
      res.send(result)
    })

    app.delete("/my/orders/:orderId",
      verityToken, 
      verifySeller,
       async (req, res) => {
  try {
    const { orderId } = req.params;
    const authenticatedUserId = req.user?.sub;

    if (!authenticatedUserId) {
      return res.status(401).json({
        message: "Please login first.",
      });
    }

    if (!ObjectId.isValid(orderId)) {
      return res.status(400).json({
        message: "Invalid order ID.",
      });
    }

    let user = null;

    if (ObjectId.isValid(authenticatedUserId)) {
      user = await usersCollection.findOne({
        _id: new ObjectId(authenticatedUserId),
      });
    }

    if (!user) {
      user = await usersCollection.findOne({
        id: authenticatedUserId,
      });
    }

    if (!user) {
      return res.status(404).json({
        message: "User not found.",
      });
    }

    const result = await ordersCollection.deleteOne({
      _id: new ObjectId(orderId),
      userId: user._id.toString(),
      status: "delivered",
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        message: "Delivered order not found or cannot be deleted.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Delivered order deleted successfully.",
    });
  } catch (error) {
    console.error("Delete order error:", error);

    return res.status(500).json({
      message: "Failed to delete order.",
    });
  }
});

    console.log(
      "Pinged your deployment. Successfully connected to MongoDB!"
    );

run().catch(console.dir);


    app.listen(port, () => {
      console.log(
        `Server is running on ${process.env.NEXT_PUBLIC_BACKEND_URL}`
      );
    });
  } catch (error) {
    console.error(
      "MongoDB connection error:",
      error
    );
  }
}

module.exports = app

